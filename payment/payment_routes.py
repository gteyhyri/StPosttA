"""
Payment Routes
API endpoints для работы с платежами
"""

import logging
import os
import time
import json
import hmac
import hashlib
from urllib.parse import parse_qsl, unquote
from flask import Blueprint, request, jsonify, g
from functools import wraps
from database import get_db
from database.models import User
from database.db import create_or_update_user
from .yookassa_service import YooKassaService
from .payment_model import PaymentModel
from .tonconnect_service import TonConnectService
from .tonconnect_model import TonPaymentModel
from datetime import datetime

# Import sanitizer
import sys
sys.path.append('..')
from utils.sanitizer import InputSanitizer

logger = logging.getLogger(__name__)

# Создаём Blueprint для платёжных маршрутов
payment_bp = Blueprint('payment', __name__, url_prefix='/api/payment')

# Telegram Bot Token и время жизни initData (как в app.py)
BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '8501227640:AAEnvc8VZa5ga3_8uN5isjUH4cGKFaCmw8c')
INIT_DATA_EXPIRATION = 86400  # 24 часа для TON платежей (транзакция может занять время)


def validate_init_data(init_data_raw):
    """
    Проверка Telegram InitData (укороченная версия из app.py).
    Возвращает (is_valid, parsed_data).
    """
    logger.info("=" * 60)
    logger.info("🔐 НАЧАЛО ВАЛИДАЦИИ INITDATA (PAYMENT)")
    logger.info(f"InitData length: {len(init_data_raw)} chars")
    logger.info(f"🔑 BOT_TOKEN в использовании: {BOT_TOKEN[:20]}...{BOT_TOKEN[-10:]}")
    
    try:
        parsed_data = dict(parse_qsl(init_data_raw))
        logger.info(f"📋 Parsed keys: {list(parsed_data.keys())}")
        
        # LOG ALL PARSED DATA (except user - too long)
        logger.info("📋 ДЕТАЛИ PARSED DATA:")
        for key, value in parsed_data.items():
            if key != 'user':
                logger.info(f"   {key} = {value}")
            else:
                logger.info(f"   user = {value[:100]}..." if len(value) > 100 else f"   user = {value}")

        received_hash = parsed_data.pop('hash', None)
        if not received_hash:
            logger.warning("❌ InitData validation failed: no hash")
            logger.info("=" * 60)
            return False, None
        
        logger.info(f"🔑 Received hash (FULL): {received_hash}")

        auth_date = parsed_data.get('auth_date')
        if not auth_date:
            logger.warning("❌ InitData validation failed: no auth_date")
            logger.info("=" * 60)
            return False, None

        try:
            auth_timestamp = int(auth_date)
            current_timestamp = int(time.time())
            age_seconds = current_timestamp - auth_timestamp
            
            logger.info(f"⏰ Auth date: {datetime.fromtimestamp(auth_timestamp)}")
            logger.info(f"⏰ Current time: {datetime.fromtimestamp(current_timestamp)}")
            logger.info(f"⏰ Age: {age_seconds} seconds ({age_seconds/60:.1f} minutes)")
            
            if age_seconds > INIT_DATA_EXPIRATION:
                logger.warning(f"❌ InitData validation failed: expired (age={age_seconds}s, max={INIT_DATA_EXPIRATION}s)")
                logger.info("=" * 60)
                return False, None
            else:
                logger.info(f"✅ InitData not expired ({INIT_DATA_EXPIRATION - age_seconds}s remaining)")
        except ValueError:
            logger.warning("❌ InitData validation failed: invalid auth_date format")
            logger.info("=" * 60)
            return False, None

        data_check_arr = [f"{k}={v}" for k, v in sorted(parsed_data.items())]
        data_check_string = '\n'.join(data_check_arr)
        
        logger.info(f"📝 Data check string created ({len(data_check_string)} chars)")
        logger.info(f"📝 DATA CHECK STRING (FULL):")
        logger.info(data_check_string)

        logger.info(f"🔐 Creating secret key with BOT_TOKEN: {BOT_TOKEN}")
        secret_key = hmac.new(
            key="WebAppData".encode(),
            msg=BOT_TOKEN.encode(),
            digestmod=hashlib.sha256
        ).digest()
        logger.info(f"🔐 Secret key generated (hex): {secret_key.hex()}")

        calculated_hash = hmac.new(
            key=secret_key,
            msg=data_check_string.encode(),
            digestmod=hashlib.sha256
        ).hexdigest()
        
        logger.info(f"🔐 Calculated hash (FULL): {calculated_hash}")

        if calculated_hash != received_hash:
            logger.error(f"❌ HASH MISMATCH!")
            logger.error(f"   Expected (calculated): {calculated_hash}")
            logger.error(f"   Received (from TG):    {received_hash}")
            logger.error(f"   BOT_TOKEN used: {BOT_TOKEN}")
            logger.info("=" * 60)
            return False, None
        
        logger.info("✅ Hash match! InitData is valid!")

        # Парсим user если он есть
        if 'user' in parsed_data:
            try:
                parsed_data['user'] = json.loads(unquote(parsed_data['user']))
                user = parsed_data['user']
                logger.info(f"👤 User: {user.get('first_name')} {user.get('last_name')} (@{user.get('username')}, ID: {user.get('id')})")
            except (json.JSONDecodeError, ValueError) as e:
                logger.error(f"❌ Error parsing user data: {e}")

        logger.info(f"✅ InitData validation successful for user_id={parsed_data.get('user', {}).get('id', 'unknown')}")
        logger.info("✅ ВАЛИДАЦИЯ УСПЕШНА")
        logger.info("=" * 60)
        return True, parsed_data

    except Exception as e:
        logger.error(f"❌ Ошибка валидации InitData (payment): {e}", exc_info=True)
        logger.info("=" * 60)
        return False, None


def require_auth(f):
    """
    Decorator для проверки авторизации по Telegram InitData
    (отдельная реализация для платёжных роутов,
    логика такая же, как в app.py).
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        endpoint = f"{request.method} {request.path}"
        
        logger.info("=" * 60)
        logger.info(f"🔐 ПРОВЕРКА АВТОРИЗАЦИИ (PAYMENT): {endpoint}")

        auth_header = request.headers.get('Authorization', '')
        logger.info(f"📋 Authorization header length: {len(auth_header)}")
        logger.info(f"📋 Authorization header (first 50): {auth_header[:50]}")
        logger.info(f"📋 Authorization header (last 50): {auth_header[-50:]}")
        
        if not auth_header or not auth_header.startswith('tma '):
            logger.warning(f"❌ No/invalid Authorization header for {endpoint}")
            logger.warning(f"   Header: '{auth_header[:100]}'")
            logger.info("=" * 60)
            return jsonify({'error': 'Unauthorized'}), 401

        init_data_raw = auth_header[4:]
        logger.info(f"📋 InitData length after 'tma ': {len(init_data_raw)}")

        is_valid, parsed_data = validate_init_data(init_data_raw)
        if not is_valid:
            logger.error(f"❌ Authorization FAILED for {endpoint} (payment)")
            logger.error(f"   InitData was: {init_data_raw[:100]}...{init_data_raw[-100:]}")
            logger.info("=" * 60)
            return jsonify({'error': 'Доступ запрещён'}), 403

        # Сохраняем данные в g, как в app.py
        g.init_data = parsed_data
        g.user = parsed_data.get('user', {})
        g.user_id = g.user.get('id')  # Добавляем user_id для удобства
        
        logger.info(f"✅ Authorization SUCCESS for user_id={g.user_id}")
        logger.info("=" * 60)

        # Синхронизируем пользователя с БД
        try:
            create_or_update_user(g.user)
        except Exception as e:
            logger.error(f"❌ Error syncing user to database (payment): {e}", exc_info=True)

        return f(*args, **kwargs)

    return decorated_function


@payment_bp.route('/create', methods=['POST'])
@require_auth
def create_payment():
    """
    Создать платёж для пополнения баланса
    
    POST /api/payment/create
    Body: {
        "amount": 100.00
    }
    
    Response: {
        "success": true,
        "payment_id": "...",
        "confirmation_url": "...",
        "amount": 100.00
    }
    """
    try:
        user_id = g.user.get('id')
        data = request.json
        
        # Получаем сумму из запроса
        amount = data.get('amount')
        
        if not amount:
            return jsonify({'error': 'Не указана сумма пополнения'}), 400
        
        try:
            amount = float(amount)
        except (ValueError, TypeError):
            return jsonify({'error': 'Некорректная сумма'}), 400
        
        if amount <= 0:
            return jsonify({'error': 'Сумма должна быть больше 0'}), 400
        
        # Инициализируем сервис ЮКасса
        yookassa = YooKassaService()
        
        # Создаём платёж в ЮКасса
        payment_data = yookassa.create_payment(
            amount=amount,
            user_id=user_id,
            description=f"Пополнение баланса пользователя {user_id}"
        )
        
        # Сохраняем платёж в БД
        db = get_db()
        cursor = db.cursor()
        
        # Проверяем наличие таблицы платежей
        PaymentModel.create_table(cursor)
        
        # Создаём запись о платеже
        PaymentModel.create(
            cursor=cursor,
            payment_id=payment_data['id'],
            user_id=user_id,
            amount=payment_data['amount'],
            currency=payment_data['currency'],
            status=payment_data['status'],
            description=payment_data['description'],
            confirmation_url=payment_data['confirmation_url'],
            metadata=str(payment_data.get('metadata', {}))
        )
        
        db.commit()
        
        logger.info(f"✅ Платёж создан и сохранён: payment_id={payment_data['id']}, user_id={user_id}")
        
        return jsonify({
            'success': True,
            'payment_id': payment_data['id'],
            'confirmation_url': payment_data['confirmation_url'],
            'amount': payment_data['amount'],
            'currency': payment_data['currency'],
            'status': payment_data['status']
        })
        
    except ValueError as e:
        logger.error(f"❌ Ошибка валидации: {e}")
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.error(f"❌ Ошибка создания платежа: {e}", exc_info=True)
        return jsonify({'error': 'Ошибка создания платежа'}), 500


@payment_bp.route('/status/<payment_id>', methods=['GET'])
@require_auth
def get_payment_status(payment_id):
    """
    Проверить статус платежа
    
    GET /api/payment/status/<payment_id>
    
    Response: {
        "payment_id": "...",
        "status": "succeeded",
        "amount": 100.00,
        "paid": true
    }
    """
    try:
        user_id = g.user.get('id')
        
        # Проверяем платёж в БД
        db = get_db()
        cursor = db.cursor()
        
        payment = PaymentModel.get_by_payment_id(cursor, payment_id)
        
        if not payment:
            return jsonify({'error': 'Платёж не найден'}), 404
        
        # Проверяем, что платёж принадлежит этому пользователю
        if payment['user_id'] != user_id:
            return jsonify({'error': 'Доступ запрещён'}), 403
        
        # Получаем актуальный статус из ЮКасса
        yookassa = YooKassaService()
        payment_info = yookassa.get_payment_info(payment_id)
        
        # Обновляем статус в БД если он изменился
        if payment_info['status'] != payment['status']:
            paid_at = payment_info.get('captured_at') if payment_info['status'] == 'succeeded' else None
            PaymentModel.update_status(cursor, payment_id, payment_info['status'], paid_at)
            
            # Если платёж успешен - начисляем баланс
            if payment_info['status'] == 'succeeded' and payment['status'] != 'succeeded':
                logger.info(f"💰 Платёж успешен! Начисляем баланс: user_id={user_id}, amount={payment['amount']}")
                User.update_balance(cursor, user_id, payment['amount'], 'add')
            
            db.commit()
        
        return jsonify({
            'payment_id': payment_id,
            'status': payment_info['status'],
            'paid': payment_info['paid'],
            'amount': payment_info['amount'],
            'currency': payment_info['currency'],
            'created_at': payment['created_at']
        })
        
    except Exception as e:
        logger.error(f"❌ Ошибка получения статуса платежа: {e}", exc_info=True)
        return jsonify({'error': 'Ошибка получения статуса'}), 500


@payment_bp.route('/webhook', methods=['POST'])
def payment_webhook():
    """
    Webhook для уведомлений от ЮКасса
    
    POST /api/payment/webhook
    
    ЮКасса отправляет уведомления при изменении статуса платежа
    """
    try:
        logger.info("=" * 60)
        logger.info("📨 WEBHOOK от ЮКасса получен")
        
        # Получаем данные от ЮКасса
        data = request.json
        logger.info(f"📨 Webhook data: {data}")
        
        if not data or 'object' not in data:
            logger.warning("❌ Некорректные данные webhook")
            return jsonify({'error': 'Invalid webhook data'}), 400
        
        # Извлекаем информацию о платеже
        payment_data = data['object']
        payment_id = payment_data.get('id')
        status = payment_data.get('status')
        paid = payment_data.get('paid', False)
        
        logger.info(f"💳 Payment ID: {payment_id}")
        logger.info(f"📊 Status: {status}")
        logger.info(f"💰 Paid: {paid}")
        
        if not payment_id:
            logger.warning("❌ Payment ID не найден в webhook")
            return jsonify({'error': 'Payment ID not found'}), 400
        
        # Обновляем платёж в БД
        db = get_db()
        cursor = db.cursor()
        
        payment = PaymentModel.get_by_payment_id(cursor, payment_id)
        
        if not payment:
            logger.warning(f"❌ Платёж {payment_id} не найден в БД")
            return jsonify({'error': 'Payment not found'}), 404
        
        user_id = payment['user_id']
        amount = payment['amount']
        old_status = payment['status']
        
        logger.info(f"👤 User ID: {user_id}")
        logger.info(f"💵 Amount: {amount}")
        logger.info(f"📊 Old status: {old_status} → New status: {status}")
        
        # Обновляем статус платежа
        paid_at = datetime.now().isoformat() if status == 'succeeded' else None
        PaymentModel.update_status(cursor, payment_id, status, paid_at)
        
        # Если платёж успешен и ранее не был успешен - начисляем баланс
        if status == 'succeeded' and old_status != 'succeeded':
            logger.info(f"✅ Платёж успешен! Начисляем баланс пользователю {user_id}")
            
            # Получаем текущий баланс
            user = User.get_by_id(cursor, user_id)
            old_balance = user['balance'] if user else 0
            
            # Начисляем баланс
            User.update_balance(cursor, user_id, amount, 'add')
            
            # Получаем новый баланс
            user = User.get_by_id(cursor, user_id)
            new_balance = user['balance'] if user else 0
            
            logger.info(f"💰 Баланс обновлён: {old_balance} → {new_balance} (+{amount})")
        
        db.commit()
        
        logger.info("✅ Webhook обработан успешно")
        logger.info("=" * 60)
        
        return jsonify({'success': True}), 200
        
    except Exception as e:
        logger.error(f"❌ Ошибка обработки webhook: {e}", exc_info=True)
        logger.info("=" * 60)
        return jsonify({'error': 'Internal server error'}), 500


@payment_bp.route('/history', methods=['GET'])
@require_auth
def get_payment_history():
    """
    Получить историю платежей пользователя
    
    GET /api/payment/history?limit=10
    
    Response: {
        "payments": [...],
        "total_paid": 1500.00
    }
    """
    try:
        user_id = g.user.get('id')
        limit = request.args.get('limit', 10, type=int)
        
        db = get_db()
        cursor = db.cursor()
        
        # Получаем платежи пользователя
        payments = PaymentModel.get_by_user(cursor, user_id, limit)
        
        # Получаем общую сумму успешных платежей
        total_paid = PaymentModel.get_user_total_paid(cursor, user_id)
        
        # Форматируем платежи для ответа
        payments_list = []
        for p in payments:
            payments_list.append({
                'payment_id': p['payment_id'],
                'amount': p['amount'],
                'currency': p['currency'],
                'status': p['status'],
                'description': p['description'],
                'created_at': p['created_at'],
                'paid_at': p.get('paid_at')
            })
        
        return jsonify({
            'payments': payments_list,
            'count': len(payments_list),
            'total_paid': total_paid
        })
        
    except Exception as e:
        logger.error(f"❌ Ошибка получения истории платежей: {e}", exc_info=True)
        return jsonify({'error': 'Ошибка получения истории'}), 500



# ============================================================================
# TON CONNECT ROUTES
# ============================================================================

@payment_bp.route('/ton/price', methods=['GET'])
@require_auth
def get_ton_price():
    """
    Получить текущую цену TON в рублях
    
    GET /api/payment/ton/price
    
    Response: {
        "price": 300.50,
        "currency": "RUB"
    }
    """
    try:
        ton_service = TonConnectService()
        price = ton_service.get_ton_price_rub()
        
        return jsonify({
            'price': price,
            'currency': 'RUB'
        })
        
    except Exception as e:
        logger.error(f"❌ Ошибка получения цены TON: {e}", exc_info=True)
        return jsonify({'error': 'Ошибка получения цены'}), 500


@payment_bp.route('/ton/create', methods=['POST'])
@require_auth
def create_ton_payment():
    """
    Создать TON платёж
    
    POST /api/payment/ton/create
    Body: {
        "amount": 100.00
    }
    
    Response: {
        "success": true,
        "payment_id": 123,
        "transaction": {...},
        "amount_rub": 100.00,
        "amount_ton": 0.333,
        "ton_price": 300.00
    }
    """
    try:
        user_id = g.user.get('id')
        data = request.json
        
        logger.info("=" * 60)
        logger.info("💳 СОЗДАНИЕ TON ПЛАТЕЖА")
        logger.info(f"👤 User ID from g.user: {user_id} (type: {type(user_id)})")
        
        # Получаем сумму из запроса
        amount = data.get('amount')
        
        if not amount:
            return jsonify({'error': 'Не указана сумма пополнения'}), 400
        
        try:
            amount = float(amount)
        except (ValueError, TypeError):
            return jsonify({'error': 'Некорректная сумма'}), 400
        
        if amount <= 0:
            return jsonify({'error': 'Сумма должна быть больше 0'}), 400
        
        if amount < 1:
            return jsonify({'error': 'Минимальная сумма пополнения: 1 руб.'}), 400
        
        if amount > 100000:
            return jsonify({'error': 'Максимальная сумма пополнения: 100 000 руб.'}), 400
        
        # Инициализируем TON сервис
        ton_service = TonConnectService()
        
        # Создаём транзакцию
        transaction_data = ton_service.create_transaction_request(amount, user_id)
        
        # Сохраняем платёж в БД
        db = get_db()
        cursor = db.cursor()
        
        # Проверяем наличие таблицы TON платежей
        TonPaymentModel.create_table(cursor)
        
        # ВАЖНО: Преобразуем user_id в int перед сохранением
        user_id_int = int(user_id)
        logger.info(f"💾 Сохраняем платёж с user_id={user_id_int} (type: {type(user_id_int)})")
        
        # Создаём запись о платеже
        payment_id = TonPaymentModel.create(
            cursor=cursor,
            user_id=user_id_int,
            amount_rub=transaction_data['amount_rub'],
            amount_ton=transaction_data['amount_ton'],
            amount_nano=transaction_data['amount_nano'],
            ton_price=transaction_data['ton_price'],
            receiver_wallet=ton_service.receiver_wallet,
            payload=transaction_data.get('payload')  # Используем payload из данных
        )
        
        db.commit()
        
        logger.info(f"✅ TON платёж создан: payment_id={payment_id}, user_id={user_id_int}")
        logger.info("=" * 60)
        
        return jsonify({
            'success': True,
            'payment_id': payment_id,
            'transaction': transaction_data['transaction'],
            'amount_rub': transaction_data['amount_rub'],
            'amount_ton': transaction_data['amount_ton'],
            'ton_price': transaction_data['ton_price'],
            'receiver_wallet': ton_service.receiver_wallet
        })
        
    except ValueError as e:
        logger.error(f"❌ Ошибка валидации: {e}")
        logger.info("=" * 60)
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.error(f"❌ Ошибка создания TON платежа: {e}", exc_info=True)
        logger.info("=" * 60)
        return jsonify({'error': 'Ошибка создания платежа'}), 500


@payment_bp.route('/ton/confirm', methods=['POST'])
@require_auth
def confirm_ton_payment():
    """
    Подтвердить TON платёж после отправки транзакции
    
    POST /api/payment/ton/confirm
    Body: {
        "payment_id": 123,
        "tx_hash": "..."
    }
    
    Response: {
        "success": true,
        "status": "completed"
    }
    """
    try:
        user_id = g.user.get('id')
        data = request.json
        
        logger.info("=" * 60)
        logger.info("💳 ПОДТВЕРЖДЕНИЕ TON ПЛАТЕЖА")
        logger.info(f"👤 User ID from g.user: {user_id} (type: {type(user_id)})")
        
        payment_id = data.get('payment_id')
        tx_hash = data.get('tx_hash')
        
        logger.info(f"💳 Payment ID: {payment_id} (type: {type(payment_id)})")
        logger.info(f"🔗 TX Hash: {tx_hash[:50]}..." if tx_hash and len(tx_hash) > 50 else f"🔗 TX Hash: {tx_hash}")
        
        if not payment_id or not tx_hash:
            logger.warning("❌ Не указаны payment_id или tx_hash")
            logger.info("=" * 60)
            return jsonify({'error': 'Не указаны payment_id или tx_hash'}), 400
        
        db = get_db()
        cursor = db.cursor()
        
        # Получаем платёж
        payment = TonPaymentModel.get_by_id(cursor, payment_id)
        
        if not payment:
            logger.warning(f"❌ Платёж {payment_id} не найден")
            logger.info("=" * 60)
            return jsonify({'error': 'Платёж не найден'}), 404
        
        logger.info(f"💳 Payment found: {payment}")
        logger.info(f"💳 Payment user_id: {payment['user_id']} (type: {type(payment['user_id'])})")
        logger.info(f"👤 Current user_id: {user_id} (type: {type(user_id)})")
        
        # ВАЖНО: Преобразуем оба значения в int для сравнения
        payment_user_id = int(payment['user_id'])
        current_user_id = int(user_id)
        
        logger.info(f"🔍 After conversion:")
        logger.info(f"   Payment user_id: {payment_user_id} (type: {type(payment_user_id)})")
        logger.info(f"   Current user_id: {current_user_id} (type: {type(current_user_id)})")
        logger.info(f"   Comparison: {payment_user_id} == {current_user_id} ? {payment_user_id == current_user_id}")
        
        # Проверяем, что платёж принадлежит этому пользователю
        if payment_user_id != current_user_id:
            logger.error(f"❌ ДОСТУП ЗАПРЕЩЁН!")
            logger.error(f"   Payment user_id: {payment_user_id}")
            logger.error(f"   Current user_id: {current_user_id}")
            logger.info("=" * 60)
            return jsonify({'error': 'Доступ запрещён'}), 403
        
        logger.info("✅ User ID match - access granted")
        
        # Проверяем, что платёж ещё не завершён
        if payment['status'] == 'completed':
            logger.warning(f"⚠️ Платёж {payment_id} уже завершён")
            logger.info("=" * 60)
            return jsonify({'error': 'Платёж уже завершён'}), 400
        
        # Обновляем платёж
        TonPaymentModel.update_transaction(cursor, payment_id, tx_hash, 'completed')
        
        # Начисляем баланс пользователю
        logger.info(f"💰 TON платёж успешен! Начисляем баланс: user_id={current_user_id}, amount={payment['amount_rub']}")
        User.update_balance(cursor, current_user_id, payment['amount_rub'], 'add')
        
        db.commit()
        
        logger.info(f"✅ TON платёж подтверждён: payment_id={payment_id}, tx_hash={tx_hash}")
        logger.info("=" * 60)
        
        return jsonify({
            'success': True,
            'status': 'completed',
            'amount_rub': payment['amount_rub']
        })
        
    except Exception as e:
        logger.error(f"❌ Ошибка подтверждения TON платежа: {e}", exc_info=True)
        logger.info("=" * 60)
        return jsonify({'error': 'Ошибка подтверждения платежа'}), 500


@payment_bp.route('/ton/status/<int:payment_id>', methods=['GET'])
@require_auth
def get_ton_payment_status(payment_id):
    """
    Проверить статус TON платежа
    
    GET /api/payment/ton/status/<payment_id>
    
    Response: {
        "payment_id": 123,
        "status": "completed",
        "amount_rub": 100.00,
        "amount_ton": 0.333,
        "tx_hash": "..."
    }
    """
    try:
        user_id = g.user.get('id')
        
        db = get_db()
        cursor = db.cursor()
        
        # Получаем платёж
        payment = TonPaymentModel.get_by_id(cursor, payment_id)
        
        if not payment:
            return jsonify({'error': 'Платёж не найден'}), 404
        
        # Проверяем, что платёж принадлежит этому пользователю
        if payment['user_id'] != user_id:
            return jsonify({'error': 'Доступ запрещён'}), 403
        
        return jsonify({
            'payment_id': payment['id'],
            'status': payment['status'],
            'amount_rub': payment['amount_rub'],
            'amount_ton': payment['amount_ton'],
            'ton_price': payment['ton_price'],
            'tx_hash': payment['tx_hash'],
            'created_at': payment['created_at'],
            'completed_at': payment['completed_at']
        })
        
    except Exception as e:
        logger.error(f"❌ Ошибка получения статуса TON платежа: {e}", exc_info=True)
        return jsonify({'error': 'Ошибка получения статуса'}), 500


@payment_bp.route('/ton/manifest', methods=['GET'])
def get_ton_manifest():
    """
    Получить манифест для TON Connect
    
    GET /api/payment/ton/manifest
    
    Response: {
        "url": "...",
        "name": "...",
        "iconUrl": "..."
    }
    """
    try:
        ton_service = TonConnectService()
        manifest = ton_service.get_manifest_data()
        
        return jsonify(manifest)
        
    except Exception as e:
        logger.error(f"❌ Ошибка получения манифеста: {e}", exc_info=True)
        return jsonify({'error': 'Ошибка получения манифеста'}), 500



@payment_bp.route('/ton/client-log', methods=['POST'])
def save_client_log():
    """
    Сохранить логи из браузера на сервер
    
    POST /api/payment/ton/client-log
    Body: {
        "logs": "...",
        "user_id": 123,
        "error": "..."
    }
    """
    try:
        data = request.json
        logs = data.get('logs', '')
        user_id = data.get('user_id', 'unknown')
        error = data.get('error', '')
        
        # Сохраняем в файл
        with open('ton_client_logs.txt', 'a', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write(f"Время: {datetime.now().isoformat()}\n")
            f.write(f"User ID: {user_id}\n")
            if error:
                f.write(f"Ошибка: {error}\n")
            f.write("Логи:\n")
            f.write(logs + "\n")
            f.write("=" * 80 + "\n\n")
        
        logger.info(f"📝 Логи клиента сохранены для user_id={user_id}")
        
        return jsonify({'success': True})
        
    except Exception as e:
        logger.error(f"❌ Ошибка сохранения логов клиента: {e}", exc_info=True)
        return jsonify({'error': 'Ошибка сохранения логов'}), 500


@payment_bp.route('/test-auth', methods=['POST'])
def test_auth():
    """
    Тестовый эндпоинт для проверки авторизации
    
    POST /api/payment/test-auth
    Headers: Authorization: tma <initData>
    
    Response: {
        "success": true,
        "user_id": 123,
        "auth_date": "...",
        "parsed_keys": [...]
    }
    """
    try:
        logger.info("=" * 60)
        logger.info("🧪 TEST AUTH ENDPOINT")
        
        auth_header = request.headers.get('Authorization', '')
        logger.info(f"📋 Authorization header length: {len(auth_header)}")
        
        if not auth_header or not auth_header.startswith('tma '):
            logger.warning("❌ No/invalid Authorization header")
            return jsonify({'error': 'No Authorization header'}), 400
        
        init_data_raw = auth_header[4:]
        logger.info(f"📋 InitData length: {len(init_data_raw)}")
        
        is_valid, parsed_data = validate_init_data(init_data_raw)
        
        if not is_valid:
            logger.error("❌ Validation FAILED")
            logger.info("=" * 60)
            return jsonify({
                'success': False,
                'error': 'Validation failed',
                'init_data_length': len(init_data_raw)
            }), 403
        
        user = parsed_data.get('user', {})
        
        logger.info("✅ Validation SUCCESS")
        logger.info("=" * 60)
        
        return jsonify({
            'success': True,
            'user_id': user.get('id'),
            'username': user.get('username'),
            'auth_date': parsed_data.get('auth_date'),
            'parsed_keys': list(parsed_data.keys())
        })
        
    except Exception as e:
        logger.error(f"❌ Test auth error: {e}", exc_info=True)
        logger.info("=" * 60)
        return jsonify({'error': str(e)}), 500


# ============================================================================
# WITHDRAWAL ENDPOINTS
# ============================================================================

@payment_bp.route('/withdraw/request', methods=['POST'])
@require_auth
def create_withdrawal_request():
    """
    Создать запрос на вывод средств
    
    POST /api/payment/withdraw/request
    Headers: Authorization: tma <initData>
    Body: {
        "amount": 1000.0,
        "wallet_address": "UQD..."
    }
    
    Response: {
        "success": true,
        "request_id": 1,
        "amount": 1000.0,
        "wallet_address": "UQD..."
    }
    """
    try:
        logger.info("=" * 60)
        logger.info("💸 CREATE WITHDRAWAL REQUEST")
        
        # Получаем user_id из декоратора
        user_id = g.user_id
        logger.info(f"👤 User ID: {user_id}")
        
        # Получаем данные из запроса
        data = request.get_json()
        amount = data.get('amount')
        wallet_address = data.get('wallet_address')
        
        logger.info(f"💰 Amount: {amount}")
        logger.info(f"💼 Wallet: {wallet_address}")
        
        # Валидация
        if not amount or amount <= 0:
            logger.warning("❌ Invalid amount")
            return jsonify({'error': 'Некорректная сумма'}), 400
        
        if not wallet_address:
            logger.warning("❌ No wallet address")
            return jsonify({'error': 'Адрес кошелька не указан'}), 400
        
        # Получаем пользователя из БД
        db = get_db()
        cursor = db.cursor()
        
        cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        user = cursor.fetchone()
        
        if not user:
            logger.error(f"❌ User {user_id} not found")
            return jsonify({'error': 'Пользователь не найден'}), 404
        
        # Проверяем, что пользователь - блогер
        if user['user_type'] != 'blogger':
            logger.warning(f"❌ User {user_id} is not a blogger")
            return jsonify({'error': 'Вывод доступен только для блогеров'}), 403
        
        # Проверяем баланс
        balance = float(user['balance'])
        if amount > balance:
            logger.warning(f"❌ Insufficient balance: {balance} < {amount}")
            return jsonify({'error': 'Недостаточно средств'}), 400
        
        # Создаём запрос на вывод
        from database.withdrawal_model import WithdrawalModel
        
        request_id = WithdrawalModel.create(cursor, user_id, amount, wallet_address)
        
        # Списываем средства с баланса (резервируем)
        new_balance = balance - amount
        cursor.execute("""
            UPDATE users 
            SET balance = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        """, (new_balance, user_id))
        
        db.commit()
        
        logger.info(f"✅ Withdrawal request created: ID={request_id}")
        logger.info(f"💰 Balance updated: {balance} -> {new_balance}")
        
        # Отправляем уведомление администратору через бота
        try:
            from telegram_bot import notify_admin_about_withdrawal_sync
            notify_admin_about_withdrawal_sync(request_id)
            logger.info("✅ Admin notified about withdrawal request")
        except Exception as e:
            logger.error(f"❌ Error notifying admin: {e}")
        
        logger.info("=" * 60)
        
        return jsonify({
            'success': True,
            'request_id': request_id,
            'amount': amount,
            'wallet_address': wallet_address,
            'new_balance': new_balance
        })
        
    except Exception as e:
        logger.error(f"❌ Error creating withdrawal request: {e}", exc_info=True)
        logger.info("=" * 60)
        return jsonify({'error': 'Ошибка создания запроса на вывод'}), 500


@payment_bp.route('/withdraw/status/<int:request_id>', methods=['GET'])
@require_auth
def get_withdrawal_status(request_id):
    """
    Получить статус запроса на вывод
    
    GET /api/payment/withdraw/status/<request_id>
    Headers: Authorization: tma <initData>
    
    Response: {
        "success": true,
        "request": {
            "id": 1,
            "amount": 1000.0,
            "wallet_address": "UQD...",
            "status": "pending",
            "created_at": "...",
            "processed_at": null
        }
    }
    """
    try:
        logger.info(f"📊 GET WITHDRAWAL STATUS: request_id={request_id}")
        
        user_id = g.user_id
        
        db = get_db()
        cursor = db.cursor()
        
        from database.withdrawal_model import WithdrawalModel
        
        withdrawal = WithdrawalModel.get_by_id(cursor, request_id)
        
        if not withdrawal:
            logger.warning(f"❌ Withdrawal request {request_id} not found")
            return jsonify({'error': 'Запрос не найден'}), 404
        
        # Проверяем, что запрос принадлежит пользователю
        if withdrawal['user_id'] != user_id:
            logger.warning(f"❌ User {user_id} tried to access withdrawal {request_id} of user {withdrawal['user_id']}")
            return jsonify({'error': 'Доступ запрещён'}), 403
        
        return jsonify({
            'success': True,
            'request': withdrawal
        })
        
    except Exception as e:
        logger.error(f"❌ Error getting withdrawal status: {e}", exc_info=True)
        return jsonify({'error': 'Ошибка получения статуса'}), 500
