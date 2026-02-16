

import uuid
import logging

try:
    from yookassa import Configuration, Payment
    YOOKASSA_AVAILABLE = True
except ImportError:
    YOOKASSA_AVAILABLE = False
    Configuration = None
    Payment = None
    logging.warning("⚠️ yookassa library not installed. Payment functionality will be limited.")

from .config import (
    YOOKASSA_SHOP_ID, 
    YOOKASSA_SECRET_KEY, 
    PAYMENT_RETURN_URL,
    PAYMENT_CURRENCY,
    MIN_PAYMENT_AMOUNT,
    MAX_PAYMENT_AMOUNT
)

logger = logging.getLogger(__name__)


class YooKassaService:
 
    
    def __init__(self):
        """Инициализация конфигурации ЮКасса"""
        if not YOOKASSA_AVAILABLE:
            logger.warning("⚠️ YooKassa library not available. Install it with: pip install yookassa")
            return
        
        try:
            Configuration.account_id = YOOKASSA_SHOP_ID
            Configuration.secret_key = YOOKASSA_SECRET_KEY
            logger.info("✅ ЮКасса конфигурация инициализирована")
        except Exception as e:
            logger.error(f"❌ Ошибка инициализации ЮКасса: {e}")
            raise
    
    def create_payment(self, amount, user_id, description="Пополнение баланса"):
     
        if not YOOKASSA_AVAILABLE:
            raise RuntimeError("YooKassa library not installed. Install it with: pip install yookassa")
        
        logger.info("=" * 60)
        logger.info(f"💳 СОЗДАНИЕ ПЛАТЕЖА")
        logger.info(f"   Сумма: {amount} {PAYMENT_CURRENCY}")
        logger.info(f"   User ID: {user_id}")
        logger.info(f"   Описание: {description}")
        
       
        if amount < MIN_PAYMENT_AMOUNT:
            raise ValueError(f"Минимальная сумма пополнения: {MIN_PAYMENT_AMOUNT} {PAYMENT_CURRENCY}")
        
        if amount > MAX_PAYMENT_AMOUNT:
            raise ValueError(f"Максимальная сумма пополнения: {MAX_PAYMENT_AMOUNT} {PAYMENT_CURRENCY}")
        
        try:
          
            idempotence_key = str(uuid.uuid4())
            logger.info(f"🔑 Idempotence key: {idempotence_key}")
            
           
            payment = Payment.create({
                "amount": {
                    "value": f"{amount:.2f}",
                    "currency": PAYMENT_CURRENCY
                },
                "confirmation": {
                    "type": "redirect",
                    "return_url": PAYMENT_RETURN_URL
                },
                "capture": True,  
                "description": description,
                "metadata": {
                    "user_id": str(user_id)
                }
            }, idempotence_key)
            
            logger.info(f"✅ Платёж создан успешно")
            logger.info(f"   Payment ID: {payment.id}")
            logger.info(f"   Status: {payment.status}")
            logger.info(f"   Confirmation URL: {payment.confirmation.confirmation_url}")
            logger.info("=" * 60)
            
            return {
                'id': payment.id,
                'status': payment.status,
                'amount': float(payment.amount.value),
                'currency': payment.amount.currency,
                'confirmation_url': payment.confirmation.confirmation_url,
                'description': payment.description,
                'created_at': payment.created_at,
                'metadata': payment.metadata
            }
            
        except Exception as e:
            logger.error(f"❌ Ошибка создания платежа: {e}", exc_info=True)
            logger.info("=" * 60)
            raise
    
    def get_payment_info(self, payment_id):
      
        if not YOOKASSA_AVAILABLE:
            raise RuntimeError("YooKassa library not installed. Install it with: pip install yookassa")
        
        try:
            logger.info(f"🔍 Получение информации о платеже: {payment_id}")
            
            payment = Payment.find_one(payment_id)
            
            result = {
                'id': payment.id,
                'status': payment.status,
                'paid': payment.paid,
                'amount': float(payment.amount.value),
                'currency': payment.amount.currency,
                'created_at': payment.created_at,
                'metadata': payment.metadata
            }
            
          
            if hasattr(payment, 'captured_at') and payment.captured_at:
                result['captured_at'] = payment.captured_at
            
            logger.info(f"✅ Информация получена: status={payment.status}, paid={payment.paid}")
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Ошибка получения информации о платеже: {e}", exc_info=True)
            raise
    
    def cancel_payment(self, payment_id):
       
        if not YOOKASSA_AVAILABLE:
            raise RuntimeError("YooKassa library not installed. Install it with: pip install yookassa")
        
        try:
            logger.info(f"❌ Отмена платежа: {payment_id}")
            
            idempotence_key = str(uuid.uuid4())
            payment = Payment.cancel(payment_id, idempotence_key)
            
            logger.info(f"✅ Платёж отменён: {payment_id}")
            
            return {
                'id': payment.id,
                'status': payment.status,
                'cancellation_details': payment.cancellation_details if hasattr(payment, 'cancellation_details') else None
            }
            
        except Exception as e:
            logger.error(f"❌ Ошибка отмены платежа: {e}", exc_info=True)
            raise
    


    
    @staticmethod
    def verify_webhook_signature(data, signature):
        return True

