from flask import Flask, render_template, jsonify, request, g, make_response, send_from_directory
from functools import wraps
import os
import hashlib
import hmac
from urllib.parse import parse_qsl, unquote
import time
import json
import logging
from datetime import datetime
import asyncio
import concurrent.futures

# Загрузка переменных окружения из .env файла
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv не установлен, используем системные переменные

from database import init_db, get_db, close_db
from database.db import (
    create_or_update_user,
    get_user_profile_data,
    get_user_order_history,
    get_user_active_ads
)
from database.models import User, Order, Advertisement, BloggerApplication, ChatMessage, AdPost, Offer, OfferPublication


from payment import payment_bp
from blogger_channels import blogger_channels_bp








logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler()  
    ]
)
logger = logging.getLogger(__name__)


def run_async(coro, timeout=30):
    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(_run_in_new_loop, coro)
        return future.result(timeout=timeout)


def _run_in_new_loop(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        try:
          
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
          
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        except Exception as e:
            logger.debug(f"ошщибка цикла: {e}")
        finally:
            try:
                loop.close()
            except Exception as e:
                logger.debug(f"ошибка: {e}")


app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-here')

init_db()

app.teardown_appcontext(close_db)

app.register_blueprint(payment_bp)


app.register_blueprint(blogger_channels_bp)


STATIC_VERSION = str(int(time.time()))





BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', 'ТУТтокен')





INIT_DATA_EXPIRATION = 3600

def validate_init_data(init_data_raw):

    logger.info("=" * 60)
    logger.info(" НАЧАЛО ВАЛИДАЦИИ ")
    logger.info(f"InitData length: {len(init_data_raw)} chars")
    logger.info(f"токен : {BOT_TOKEN[:20]}...{BOT_TOKEN[-10:]}")
    logger.info(f"токен: {BOT_TOKEN}")
    
    try:
    
        parsed_data = dict(parse_qsl(init_data_raw))
        logger.info(f"лог key: {list(parsed_data.keys())}")
        
 
        logger.info("parse :")
        for key, value in parsed_data.items():
            if key != 'user':
                logger.info(f"   {key} = {value}")
            else:
                logger.info(f"   user = {value[:100]}..." if len(value) > 100 else f"   user = {value}")
        
      
        received_hash = parsed_data.pop('hash', None)
        if not received_hash:
            logger.warning(" Hash not found in InitData")
            return False, None
        
        logger.info(f" Received hash (FULL): {received_hash}")
        
        
        auth_date = parsed_data.get('auth_date')
        if not auth_date:
            logger.warning("autf   date not found")
            return False, None
        
        try:
            auth_timestamp = int(auth_date)
            current_timestamp = int(time.time())
            age_seconds = current_timestamp - auth_timestamp
            
            logger.info(f" Auth date: {datetime.fromtimestamp(auth_timestamp)}")
            logger.info(f" Current time: {datetime.fromtimestamp(current_timestamp)}")
            logger.info(f" Age: {age_seconds} seconds ({age_seconds/60:.1f} minutes)")
            
      
            if age_seconds > INIT_DATA_EXPIRATION:
                logger.warning(f"InitData expired! {age_seconds} > {INIT_DATA_EXPIRATION}")
                return False, None
            else:
                logger.info(f"InitData not expired ({INIT_DATA_EXPIRATION - age_seconds}s remaining)")
        except ValueError as e:
            logger.error(f"Invalid auth_date: {e}")
            return False, None
        
        
        data_check_arr = [f"{k}={v}" for k, v in sorted(parsed_data.items())]
        data_check_string = '\n'.join(data_check_arr)
        logger.info(f" Data check string created ({len(data_check_string)} chars)")
        logger.info(f" DATA CHECK STRING (FULL):")
        logger.info(data_check_string)
        logger.info(f" DATA CHECK ARR: {data_check_arr}")
        
  
        logger.info(f"Creating secret key with: {BOT_TOKEN}")
        secret_key = hmac.new(
            key="WebAppData".encode(),
            msg=BOT_TOKEN.encode(),
            digestmod=hashlib.sha256
        ).digest()
        logger.info(f"Secret key generated: {secret_key.hex()}")
        
        # Step 3: Calculate hash
        calculated_hash = hmac.new(
            key=secret_key,
            msg=data_check_string.encode(),
            digestmod=hashlib.sha256
        ).hexdigest()
        logger.info(f"Calculated hash: {calculated_hash}")
        
        # Step 4: Compare hashes
        if calculated_hash != received_hash:
            logger.error(f"HASH MISMATCH!")
            logger.error(f"Expected (calculated): {calculated_hash}")
            logger.error(f"  Received (from TG):    {received_hash}")
            logger.error(f"   BOT_TOKEN used: {BOT_TOKEN}")
            return False, None
        
        logger.info("хеш ВЕРНЫЙ ")
        
      
        if 'user' in parsed_data:
            try:
                parsed_data['user'] = json.loads(unquote(parsed_data['user']))
                user = parsed_data['user']
                logger.info(f"👤 User: {user.get('first_name')} {user.get('last_name')} (@{user.get('username')}, ID: {user.get('id')})")
            except (json.JSONDecodeError, ValueError) as e:
                logger.error(f"❌ Error parsing user data: {e}")
        
        logger.info("УСПЕШНАЯ ВАлидация")
        logger.info("=" * 60)
        return True, parsed_data
        
    except Exception as e:
        logger.error(f"ОШИБКА: {str(e)}", exc_info=True)
        logger.info("=" * 60)
        return False, None

def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        endpoint = f"{request.method} {request.path}"
        logger.info(f"\nIncoming request: {endpoint}")
        logger.info(f"IP: {request.remote_addr}")
        auth_header = request.headers.get('Authorization', '')

        if not auth_header:
            logger.warning(f"No Authorization header for {endpoint}")
            return jsonify({'error': 'Unauthorized', 'message': 'Missing authorization header'}), 401

        if not auth_header.startswith('tma '):
            logger.warning(f"Invalid Authorization format for {endpoint}")
            return jsonify({'error': 'Unauthorized', 'message': 'Invalid authorization header format'}), 401
        
    
        init_data_raw = auth_header[4:]  
        is_valid, parsed_data = validate_init_data(init_data_raw)
        


        if not is_valid:
            logger.error(f"Authorization FAILED for {endpoint}")
            return jsonify({'error': 'Unauthorized', 'message': 'Invalid or expired authorization data'}), 401
        
        g.init_data = parsed_data
        g.user = parsed_data.get('user', {})
        
     
        referrer_id = None
        try:
            start_param = parsed_data.get('start_param') or parsed_data.get('startapp') or ''
            if isinstance(start_param, str) and start_param.startswith('ref_'):
                ref_str = start_param.split('ref_', 1)[-1]
                if ref_str.isdigit():
                    referrer_id = int(ref_str)
        except Exception as e:
            logger.error(f"Error parsing referral from init_data: {e}")
            referrer_id = None

    
        try:
            create_or_update_user(g.user, referrer_id=referrer_id)
            logger.info(f" User data synchronized with database")
        except Exception as e:
            logger.error(f" Error syncing user to database: {e}")
        
        logger.info(f" Authorization for {endpoint}")
        logger.info(f"User: {g.user.get('id')}\n")
        
        return f(*args, **kwargs)
    
    return decorated_function



@app.route('/')
def index():

    response = make_response(render_template('index.html', static_v=STATIC_VERSION))

    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response




@app.route('/tonconnect-manifest.json')
def tonconnect_manifest():
    return send_from_directory('static', 'tonconnect-manifest.json', mimetype='application/json')




@app.route('/api/user/profile', methods=['GET'])
@require_auth
def get_user_profile():
    
    try:
        user_id = g.user.get('id')
        
     
        profile = get_user_profile_data(user_id)
        
        if not profile:
            return jsonify({'error': 'User not found'}), 404
        

        profile['is_premium'] = bool(profile.get('is_premium', 0))
        
        return jsonify(profile)
    except Exception as e:
        logger.error(f"Ошибкаа: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/user/balance', methods=['GET'])
@require_auth
def get_balance():

    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        
        user = User.get_by_id(cursor, user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
     
        from database.escrow_model import EscrowTransaction
        escrow_balance = EscrowTransaction.get_user_escrow_balance(cursor, user_id)
        




        return jsonify({
            'balance': user.get('balance', 0.00),
            'escrow_balance': escrow_balance,  
            'available_balance': user.get('balance', 0.00),  
            'user_id': user_id
        })





    except Exception as e:
        logger.error(f"Error in get_balance: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500







                             #заметка23




@app.route('/api/sales/stats', methods=['GET'])
@require_auth
def get_sales_stats():
    """Get sales statistics from database"""
    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        
      
        application = BloggerApplication.get_by_user(cursor, user_id)
        
        if not application or application.get('status') != 'approved':
            return jsonify({
                'has_sales': False,
                'total_earnings': 0.00,
                'total_views': 0,
                'total_clicks': 0,
                'channels_count': 0
            })
        
   
        cursor.execute("""
            SELECT 
                COUNT(*) as channels_count,
                COALESCE(SUM(impressions), 0) as total_views,
                COALESCE(SUM(clicks), 0) as total_clicks,
                COALESCE(SUM(amount), 0) as total_earnings
            FROM orders 
            WHERE user_id = ? AND order_type = 'blogger_earning'
        """, (user_id,))
        
        stats = cursor.fetchone()
        
        return jsonify({
            'has_sales': stats['channels_count'] > 0,
            'total_earnings': stats['total_earnings'],
            'total_views': stats['total_views'],
            'total_clicks': stats['total_clicks'],
            'channels_count': stats['channels_count']
        })
    except Exception as e:
        logger.error(f"Error in get_sales_stats: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500






@app.route('/api/purchases/stats', methods=['GET'])
@require_auth
def get_purchases_stats():
    """Get purchases statistics from database"""
    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        
    
        cursor.execute("""
            SELECT 
                COUNT(*) as active_campaigns,
                COALESCE(SUM(spent), 0) as total_spent,
                COALESCE(SUM(impressions), 0) as total_impressions
            FROM advertisements 
            WHERE user_id = ? AND status = 'active'
        """, (user_id,))
        
        stats = cursor.fetchone()
        
        return jsonify({
            'has_purchases': stats['active_campaigns'] > 0,
            'total_spent': stats['total_spent'],
            'active_campaigns': stats['active_campaigns'],
            'total_impressions': stats['total_impressions']
        })
    except Exception as e:
        logger.error(f"Error in get_purchases_stats: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500





@app.route('/api/user/stats', methods=['GET'])
@require_auth
def get_user_stats():
 
    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        
      
        cursor.execute("""
            SELECT 
                COUNT(*) as total_orders,
                COALESCE(SUM(amount), 0) as total_spent
            FROM orders 
            WHERE user_id = ?
              AND order_type != 'blogger_earning'
        """, (user_id,))
        order_stats = cursor.fetchone()
        

 
        cursor.execute("""
            SELECT 
                COUNT(*) as active_ads,
                COALESCE(SUM(impressions), 0) as total_views
            FROM advertisements 
            WHERE user_id = ? AND status = 'active'
        """, (user_id,))
        ad_stats = cursor.fetchone()
        
        return jsonify({
            'total_orders': order_stats['total_orders'],
            'total_spent': order_stats['total_spent'],
            'total_views': ad_stats['total_views'],
            'active_ads': ad_stats['active_ads']
        })
    except Exception as e:
        logger.error(f"Error in get_user_stats: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500



@app.route('/api/blogger/apply', methods=['POST'])
@require_auth
def blogger_apply():
 
    return jsonify({
        'error': 'СТарая БД не юзать',
        'redirect': '/api/blogger/channels/add'
    }), 410

@app.route('/api/blogger/status', methods=['GET'])
@require_auth
def blogger_status():
    
    return jsonify({
        'error': 'СТАРАЯ БД',
        'redirect': '/api/blogger/channels/list'
    }), 410

@app.route('/api/blogger/verify', methods=['POST'])
@require_auth
def blogger_verify():

    return jsonify({
        'error': 'СТАРАЯ БД',
        'redirect': '/api/blogger/channels/<id>/verify'
    }), 410



@app.route('/api/blogger/delete-first-channel', methods=['DELETE']) #удаление 1 со старой бд НЕ ДЛЯ НОВОЙ (изменрть)
@require_auth
def delete_first_channel():

    try:
        user_id = g.user.get('id')
   
        
        db = get_db()
        cursor = db.cursor()
     
        user = User.get_by_id(cursor, user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
       
        if user.get('user_type') != 'blogger':
            logger.warning(f"User {user_id} is not a blogger")
            return jsonify({'error': 'Only bloggers can delete channels'}), 403
        
   
        application = BloggerApplication.get_by_user(cursor, user_id)
        
        if not application:
            logger.warning(f"No application found for user {user_id}")
            return jsonify({'error': 'No channel found'}), 404
        
        app_id = application.get('id')
        

        cursor.execute("""
            DELETE FROM blogger_applications WHERE id = ?
        """, (app_id,))
        
   
        cursor.execute("""
            UPDATE users 
            SET user_type = 'user',
                blogger_price = '',
                blogger_price_permanent = '',
                blogger_subscribers = '0',
                blogger_photo_url = '',
                blogger_is_active = 0
            WHERE user_id = ?
        """, (user_id,))
        
        db.commit()
        
        logger.info(f"канал удален у юещзера  {user_id}")
        
        return jsonify({
            'success': True,
            'message': 'Канал удален'
        })
        
    except Exception as e:

        return jsonify({'error': 'Internal server error'}), 500



@app.route('/api/user/orders', methods=['GET'])
@require_auth
def get_user_orders():
  
    try:
        user_id = g.user.get('id')
        limit = request.args.get('limit', 10, type=int)
        
       
        orders = get_user_order_history(user_id, limit)
        
        return jsonify({
            'orders': orders,
            'count': len(orders)
        })
    except Exception as e:
        logger.error(f"Error in get_user_orders: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500



@app.route('/api/user/ads', methods=['GET'])
@require_auth
def get_user_ads():
    
    try:
        user_id = g.user.get('id')
        
       
        ads = get_user_active_ads(user_id)
        
        return jsonify({
            'ads': ads,
            'count': len(ads)
        })
    except Exception as e:
        logger.error(f"ОШИБКА В  get user_ads: {str(e)}", exc_info=True)
        return jsonify({'error': 'Ошибка на сервере'}), 500







"""
    try:
        logger.info("=" * 60)
        logger.info("📋 GET /api/bloggers/list called НОВАЯ БД БЛОГРЕРОВ ")
        
        db = get_db()
        cursor = db.cursor()
        
        bloggers = []
        
       
   
      
        
        channel_rows = cursor.fetchall()
        logger.info(f" найдено {len(channel_rows)} каналов")


"""

















@app.route('/api/user/rating/<int:user_id>', methods=['GET'])
def get_user_rating(user_id):

    try:
        db = get_db()
        cursor = db.cursor()
        
       
        cursor.execute("""
            SELECT AVG(rating) as avg_rating, COUNT(*) as review_count
            FROM reviews
            WHERE reviewed_id = ?
        """, (user_id,))
        
        result = cursor.fetchone()
        avg_rating = result[0] if result and result[0] else 0
        review_count = result[1] if result else 0
        
        return jsonify({
            'rating': round(avg_rating, 1) if avg_rating else 0,
            'count': review_count
        })
    except Exception as e:
        logger.error(f"ОШИБКА В get_user_rating: {str(e)}", exc_info=True)
        return jsonify({'error': 'Ошибка на сервере'}), 500

@app.route('/api/review/submit', methods=['POST'])
@require_auth
def submit_review():
    
    try:
        user_id = g.user.get('id')
        data = request.json
        
        post_id = data.get('post_id')
        target_user_id = data.get('target_user_id')
        rating = data.get('rating')
        review_type = data.get('review_type')  
        review_text = data.get('review_text', '').strip()  #текст отзыва 
        
        if not all([post_id, target_user_id, rating, review_type]):
            return jsonify({'error': 'Missing required fields'}), 400
        
        if rating < 1 or rating > 5:
            return jsonify({'error': 'Rating must be between 1 and 5'}), 400
        
    
        if len(review_text) > 50:
            review_text = review_text[:50]
        
        db = get_db()
        cursor = db.cursor()
        
   
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                reviewer_id INTEGER NOT NULL,
                reviewed_id INTEGER NOT NULL,
                rating INTEGER NOT NULL,
                review_text TEXT,
                review_type TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(post_id, reviewer_id, review_type)
            )
        """)
        
    
        cursor.execute("""
            INSERT OR REPLACE INTO reviews 
            (post_id, reviewer_id, reviewed_id, rating, review_text, review_type)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (post_id, user_id, target_user_id, rating, review_text, review_type))
        
      #соо
        cursor.execute("""
            SELECT id, metadata, channel_id 
            FROM chat_messages 
            WHERE receiver_id = ? 
            AND message_type = 'system_review'
            AND json_extract(metadata, '$.post_id') = ?
            AND json_extract(metadata, '$.review_type') = ?
        """, (user_id, post_id, review_type))
        
        review_message = cursor.fetchone()
        review_channel_id = None
        
        if review_message:
            # инфа отзыва



            current_metadata = json.loads(review_message['metadata']) if isinstance(review_message['metadata'], str) else review_message['metadata']
            current_metadata['review_submitted'] = 1
            current_metadata['submitted_rating'] = rating
            current_metadata['submitted_review_text'] = review_text  
            review_channel_id = review_message.get('channel_id')
            
            cursor.execute("""
                UPDATE chat_messages 
                SET metadata = ?
                WHERE id = ?
            """, (json.dumps(current_metadata), review_message['id']))
            

            logger.info(f"ДАННЫЕ отЗыва  message_id={review_message['id']}, rating={rating}, text={review_text}, channel_id={review_channel_id}")
        else:
            logger.warning(f"сообщение ненайдено  user_id={user_id}, post_id={post_id}, review_type={review_type}")
          
            cursor.execute("""
                SELECT channel_id FROM ad_posts WHERE id = ?
            """, (post_id,))
            post_row = cursor.fetchone()
            if post_row:
                review_channel_id = post_row.get('channel_id')
        
     
        cursor.execute("""
            SELECT first_name, username FROM users WHERE user_id = ?
        """, (user_id,))
        reviewer_data = cursor.fetchone()
        reviewer_name = f"@{reviewer_data['username']}" if reviewer_data and reviewer_data['username'] else (reviewer_data['first_name'] if reviewer_data else f"ID: {user_id}")
        
   
        reviewer_type_text = 'Блогер' if review_type == 'buyer' else 'Покупатель'
        
     
        stars_filled = "⭐" * rating
        stars_empty = "☆" * (5 - rating)
        
        notification_message = f"{reviewer_type_text} {reviewer_name} оставил вам отзыв: {stars_filled}{stars_empty}"
        if review_text:
            notification_message += f"\n\n{review_text}"
        
    
        cursor.execute("""
            INSERT INTO chat_messages (sender_id, receiver_id, message, message_type, metadata, channel_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (
            user_id,
            target_user_id,
            notification_message,
            "system_notification",
            json.dumps({
                "rating": rating,
                "reviewer_type": reviewer_type_text,
                "review_text": review_text
            }),
            review_channel_id 
        ))
        
        db.commit()
        
        return jsonify({
            'success': True,
            'message': 'Review submitted successfully',
            'rating': rating,
            'review_type': review_type,
            'review_text': review_text
        })
    except Exception as e:
        logger.error(f"Error in submit_review: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/user/balance/add', methods=['POST'])
@require_auth
def add_balance():
    
    try:
        user_id = g.user.get('id')
        data = request.json
        amount = data.get('amount', 0)
        
        if amount <= 0:
            return jsonify({'error': 'Сумма должна быть больше 0'}), 400
        
        db = get_db()
        cursor = db.cursor()
        
     
        User.update_balance(cursor, user_id, amount, 'add')
        db.commit()
        
      
        user = User.get_by_id(cursor, user_id)
        
        logger.info(f"Balance added: user={user_id}, amount={amount}, new_balance={user['balance']}")
        
        return jsonify({
            'success': True,
            'balance': user['balance'],
            'message': f'Баланс пополнен на {amount} руб.'
        })
        
    except Exception as e:
        logger.error(f"Error in add_balance: {str(e)}", exc_info=True)
        return jsonify({'error': 'ошибка сервера'}), 500


@app.route('/api/orders/create', methods=['POST'])
@require_auth
def create_order():
   
    try:
        user_id = g.user.get('id')
        data = request.json
        
        order_type = data.get('order_type')
        title = data.get('title')
        description = data.get('description', '')
        amount = data.get('amount', 0)
        
        if not all([order_type, title, amount > 0]):
            return jsonify({'error': 'Некорректные данные заказа'}), 400
        
        db = get_db()
        cursor = db.cursor()
        
       
        user = User.get_by_id(cursor, user_id)
        if user['balance'] < amount:
            return jsonify({'error': 'Недостаточно средств на балансе'}), 400
        
    
        order_id = Order.create(cursor, user_id, order_type, title, description, amount)
        
   
        User.update_balance(cursor, user_id, amount, 'subtract')
        User.update_stats(cursor, user_id, total_orders=1, total_spent=amount)
        
        db.commit()
        
        logger.info(f"Order created: id={order_id}, user={user_id}, amount={amount}")
        
        return jsonify({
            'success': True,
            'order_id': order_id,
            'message': 'Заказ успешно создан'
        })
        
    except Exception as e:
        logger.error(f"Error in create_order: {str(e)}", exc_info=True)
        return jsonify({'error': 'ошибка  сервера'}), 500

@app.route('/api/ads/create', methods=['POST'])
@require_auth
def create_advertisement():
   
    try:
        user_id = g.user.get('id')
        data = request.json
        
        title = data.get('title')
        description = data.get('description', '')
        target_url = data.get('target_url', '')
        budget = data.get('budget', 0)
        
        if not all([title, budget > 0]):
            return jsonify({'error': 'Некорректные данные рекламы'}), 400
        
        db = get_db()
        cursor = db.cursor()
        
        
        user = User.get_by_id(cursor, user_id)
        if user['balance'] < budget:
            return jsonify({'error': 'Недостаточно средств на балансе'}), 400
        
       
        ad_id = Advertisement.create(cursor, user_id, title, description, target_url, budget)
        
      
        User.update_balance(cursor, user_id, budget, 'subtract')
        
        db.commit()
        
        logger.info(f"Advertisement created: id={ad_id}, user={user_id}, budget={budget}")
        
        return jsonify({
            'success': True,
            'ad_id': ad_id,
            'message': 'Реклама успешно создана'
        })
        
    except Exception as e:
        logger.error(f"Error in create_advertisement: {str(e)}", exc_info=True)
        return jsonify({'error': 'ошибка  сервера'}), 500

@app.route('/api/bloggers/list', methods=['GET'])
@require_auth
def get_active_bloggers():

    try:
        logger.info("=" * 60)
        logger.info("📋 GET /api/bloggers/list called НОВАЯ БД БЛОГРЕРОВ ")
        
        db = get_db()
        cursor = db.cursor()
        
        bloggers = []
        
       
        logger.info("Поиск.................")
        cursor.execute("""
            SELECT bc.id, bc.user_id, bc.channel_name, bc.channel_link, bc.channel_id,
                   bc.channel_photo_url, bc.subscribers_count, bc.price, bc.price_permanent,
                   bc.topic_group_key, bc.topic_sub_key, bc.topic_sub_title,
                   u.username, u.first_name, u.last_name,
                   COALESCE(AVG(r.rating), 0) as avg_rating
            FROM blogger_channels bc
            JOIN users u ON bc.user_id = u.user_id
            LEFT JOIN reviews r ON u.user_id = r.reviewed_id AND r.review_type = 'blogger'
            WHERE bc.is_active = 1 
              AND bc.is_verified = 1
              AND u.user_type = 'blogger'
            GROUP BY bc.id
        """)
        
        channel_rows = cursor.fetchall()
        logger.info(f" найдено {len(channel_rows)} каналов")
        
        for row in channel_rows:
           
            price = row.get('price', '')
            if not price:
                price = '0'
            
       
            subscribers = row.get('subscribers_count', '')
            if not subscribers or subscribers == '':
                subscribers = '0'
                
      
            channel_display = row.get('channel_name', '')
            if not channel_display:
                channel_link = row.get('channel_link', '')
                if channel_link:
                    import re
                    patterns = [r't\.me/([^/\?]+)', r'telegram\.me/([^/\?]+)', r'@(\w+)']
                    for pattern in patterns:
                        match = re.search(pattern, channel_link)
                        if match:
                            username = match.group(1)
                            if not username.startswith('@'):
                                username = '@' + username
                            channel_display = username
                            break
                
                if not channel_display:
                    channel_display = f"@{row.get('username')}" if row.get('username') else f"ID: {row.get('user_id')}"
            
           
            photo_url = row.get('channel_photo_url')
            if not photo_url:
            
                photo_url = f"https://ui-avatars.com/api/?name={channel_display}&background=2481cc&color=fff&size=128"
            avg_rating = row.get('avg_rating', 0)
            rating_display = round(avg_rating, 1) if avg_rating > 0 else 0
            
     
            price_permanent = row.get('price_permanent', '')
            if not price_permanent:
                price_permanent = '0'
            
      
            topic_sub_title = row.get('topic_sub_title', '')
            if not topic_sub_title or topic_sub_title == '':
                topic_sub_title = 'Без тематики'

            bloggers.append({
                'channel_id': row.get('id'),
                'user_id': row.get('user_id'),
                'name': channel_display, 
                'image': photo_url,
                'subscribers': subscribers,
                'price': f"{price} ₽ / 12ч",
                'price_permanent': price_permanent,
                'channel_link': row.get('channel_link', ''),
                'telegram_channel_id': row.get('channel_id', ''),
                'raw_price': float(price) if price.replace('.','',1).isdigit() else 0,
                'topic_group_key': row.get('topic_group_key'),
                'topic_sub_key': row.get('topic_sub_key'),
                'topic_sub_title': topic_sub_title,
                'rating': rating_display
            })
            logger.info(f"  КАНАЛЫ: user_id={row.get('user_id')}, name={channel_display}, channel_id={row.get('id')}")
        
        logger.info(f"все каналы: {len(bloggers)}")
        logger.info("=" * 60)
        
        return jsonify({
            'bloggers': bloggers,
            'count': len(bloggers)
        })
        
    except Exception as e:
        logger.error(f"ОШИБКА АКТ БЛОГЕРОВ: {str(e)}", exc_info=True)
        return jsonify({'error': 'ошибка сервера'}), 500

@app.route('/api/blogger/card', methods=['GET']) #ПОФИКСИТЬ СТАТУСЫ
@require_auth
def get_blogger_card():
   
    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        
        logger.info(f"ЗАГРУЗКА: {user_id}")
        
        
        user = User.get_by_id(cursor, user_id)

        if not user:
            logger.error(f" {user_id} НЕТ")
            return jsonify({'error': 'не найден'}), 404
        
        is_blogger = user.get('user_type') == 'blogger'
        logger.info(f"User {user_id} is_blogger: {is_blogger}")
    
        application = BloggerApplication.get_by_user(cursor, user_id)
        channel_username = None

        channel_link = None

        subscribers_count = 0

        channel_photo_url = user.get('blogger_photo_url', '')
        



        if application and application.get('status') == 'approved':
            channel_link = application.get('channel_link', '')
            channel_id = application.get('channel_id', '')
            
            logger.info(f"Application found - channel_link: {channel_link}, channel_id: {channel_id}")
            
      
            import re
            patterns = [
                r't\.me/([^/\?]+)',
                r'telegram\.me/([^/\?]+)',
                r'@(\w+)'
            ]
            
            for pattern in patterns:
                match = re.search(pattern, channel_link)
                if match:
                    channel_username = match.group(1)
                    if not channel_username.startswith('@'):
                        channel_username = '@' + channel_username
                    break
            
    
            



         
            if channel_id or channel_username:
                try:
                    from telegram_bot import bot, BOT_TOKEN
                    
                    
                    chat_identifier = channel_username if channel_username else channel_id
                    logger.info(f"Requesting real-time data for: {chat_identifier}")
                    
                    async def get_channel_data():
                     
                        try:
                            
                            chat = await bot.get_chat(chat_identifier)
                            
                         
                            member_count = await bot.get_chat_member_count(chat_identifier)
                            
                           
                            photo_url = ''
                            if chat.photo:
                                photo_file = await bot.get_file(chat.photo.big_file_id)
                                photo_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{photo_file.file_path}"
                            
                            return {
                                'subscribers_count': member_count,
                                'channel_photo_url': photo_url
                            }
                        except Exception as e:
                            logger.error(f"Error getting channel data: {e}")
                            return None
                    
                    channel_data = run_async(get_channel_data())
                    
                    if channel_data:
                        subscribers_count = channel_data['subscribers_count']
                        if channel_data['channel_photo_url']:
                            channel_photo_url = channel_data['channel_photo_url']
                        
                        logger.info(f"✅ Successfully got real-time data for {chat_identifier}: {subscribers_count} subscribers")
                        
                        
                        cursor.execute("""
                            UPDATE users 
                            SET blogger_subscribers = ?,
                                blogger_photo_url = ?
                            WHERE user_id = ?
                        """, (str(subscribers_count), channel_photo_url, user_id))
                        db.commit()
                        logger.info(f"✅ Updated database with fresh data")
                    else:
                        # Fallback to database value
                        subscribers_count = int(user.get('blogger_subscribers', 0)) if user.get('blogger_subscribers', '0').isdigit() else 0
                        logger.warning(f"Using fallback subscribers count: {subscribers_count}")
                        
                except Exception as e:
                    logger.error(f"❌ Error getting real-time subscribers count for {chat_identifier}: {e}", exc_info=True)
                   
                    subscribers_count = int(user.get('blogger_subscribers', 0)) if user.get('blogger_subscribers', '0').isdigit() else 0
            else:
                logger.warning(f"No channel_id or channel_username available")
                
                subscribers_count = int(user.get('blogger_subscribers', 0)) if user.get('blogger_subscribers', '0').isdigit() else 0
        else:
            logger.warning(f"No approved application found for user {user_id}")
           
            subscribers_count = int(user.get('blogger_subscribers', 0)) if user.get('blogger_subscribers', '0').isdigit() else 0
        












        result = {
            'is_blogger': is_blogger,
            'blogger_photo_url': channel_photo_url,
            'blogger_price': user.get('blogger_price', ''),
            'blogger_price_permanent': user.get('blogger_price_permanent', ''),
            'blogger_subscribers': subscribers_count,
            'blogger_is_active': bool(user.get('blogger_is_active', 0)),
            'channel_username': channel_username,
            'channel_link': channel_link,
            'topic_sub_title': application.get('topic_sub_title', '') if application else ''
        }
        
        logger.info(f"Returning blogger card data: {result}")
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"ОШИБКА: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/blogger/card/update', methods=['POST'])
@require_auth
def update_blogger_card():
    
    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        

        user = User.get_by_id(cursor, user_id)
        if not user or user.get('user_type') != 'blogger':
            return jsonify({'error': 'не блогер'}), 403
        
        data = request.json
        

        cursor.execute("""
            UPDATE users 
            SET blogger_price = ?,
                blogger_price_permanent = ?,
                blogger_is_active = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        """, (
            data.get('blogger_price_12h', ''),
            data.get('blogger_price_permanent', ''),
            1 if data.get('blogger_is_active', False) else 0,
            user_id
        ))
        
        db.commit()
        
        logger.info(f"Blogger card updated: user={user_id}, price_12h={data.get('blogger_price_12h', '')}, price_permanent={data.get('blogger_price_permanent', '')}")
        
        return jsonify({
            'success': True,
            'message': 'Карточка блогера обновлена'
        })
        
    except Exception as e:
        logger.error(f"Error in update_blogger_card: {str(e)}", exc_info=True)
        return jsonify({'error': 'ошибка сервера'}), 500


@app.route('/api/blogger/schedule', methods=['GET'])
@require_auth
def get_blogger_schedule():
    
    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()

        cursor.execute("""
            SELECT weekday_short, from_time, to_time
            FROM blogger_schedules
            WHERE user_id = ?
            ORDER BY id
        """, (user_id,))

        rows = cursor.fetchall() or []

        return jsonify({
            'schedule': rows
        })
    except Exception as e:
        logger.error(f"Error getting blogger schedule: {str(e)}", exc_info=True)
        return jsonify({'error': ' ошибка сервера'}), 500


@app.route('/api/blogger/<int:blogger_id>/schedule', methods=['GET'])
@require_auth
def get_public_blogger_schedule(blogger_id):

    try:
        db = get_db()
        cursor = db.cursor()

        cursor.execute("""
            SELECT weekday_short, from_time, to_time
            FROM blogger_schedules
            WHERE user_id = ?
            ORDER BY id
        """, (blogger_id,))

        rows = cursor.fetchall() or []

        return jsonify({
            'schedule': rows,
            'blogger_id': blogger_id
        })
    except Exception as e:
        logger.error(f"Error getting public blogger schedule for {blogger_id}: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500


@app.route('/api/blogger/schedule', methods=['POST'])
@require_auth
def save_blogger_schedule():

    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()

        data = request.json or {}
        schedule = data.get('schedule', [])

        if not isinstance(schedule, list):
            return jsonify({'error': 'Не тот формат'}), 400

   
        normalized = []
        invalid_items = 0
        for item in schedule:
            weekday_short = (item.get('weekday_short') or '').strip()
            from_time = (item.get('from_time') or '').strip()
            to_time = (item.get('to_time') or '').strip()

            if not weekday_short or not from_time or not to_time:
                invalid_items += 1
                continue
            
        
            if len(from_time) != 5 or len(to_time) != 5 or from_time[2] != ':' or to_time[2] != ':':
                invalid_items += 1
                continue

            try:
                from_h, from_m = [int(x) for x in from_time.split(':')]
                to_h, to_m = [int(x) for x in to_time.split(':')]
            except (TypeError, ValueError):
                invalid_items += 1
                continue

            def _valid_part(h, m):
                return 0 <= h <= 23 and 0 <= m <= 59

          
            if not _valid_part(from_h, from_m) or not _valid_part(to_h, to_m):
                logger.warning(f"Skipping invalid time range in schedule: {from_time}-{to_time} for {weekday_short}")
                invalid_items += 1
                continue
            
            normalized.append((weekday_short, from_time, to_time))

    
        if invalid_items > 0:
            return jsonify({
                'error': 'Некорректное время. Введите время в формате ЧЧ:ММ в диапазоне от 00:00 до 23:59'
            }), 400


        cursor.execute("DELETE FROM blogger_schedules WHERE user_id = ?", (user_id,))

        if normalized:
            cursor.executemany("""
                INSERT INTO blogger_schedules (user_id, weekday_short, from_time, to_time)
                VALUES (?, ?, ?, ?)
            """, [(user_id, w, f, t) for (w, f, t) in normalized])

        db.commit()

        return jsonify({
            'success': True,
            'saved_days': len(normalized)
        })
    except Exception as e:
        logger.error(f"Error saving blogger schedule: {str(e)}", exc_info=True)
        return jsonify({'error': ' ошибка сервера'}), 500


@app.route('/api/blogger/photo/upload', methods=['POST'])
@require_auth
def upload_blogger_photo():

    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        

        user = User.get_by_id(cursor, user_id)
        if not user or user.get('user_type') != 'blogger':
            return jsonify({'error': 'не блогеер'}), 403
        
    
        if 'photo' not in request.files:
            return jsonify({'error': 'Файл не найден'}), 400
        
        file = request.files['photo']
        

        if file.filename == '':
            return jsonify({'error': 'Файл не выбран'}), 400
        
        

        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        



        if file_ext not in allowed_extensions:
            return jsonify({'error': 'Недопустимый формат файла'}), 400
        
    

        import uuid
        filename = f"blogger_{user_id}_{uuid.uuid4().hex}.{file_ext}"
        
     



        upload_folder = os.path.join('static', 'uploads', 'bloggers')
        os.makedirs(upload_folder, exist_ok=True)
        


        file_path = os.path.join(upload_folder, filename)
        file.save(file_path)
        




   
        photo_url = f"/static/uploads/bloggers/{filename}"
        cursor.execute("""
            UPDATE users 
            SET blogger_photo_url = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        """, (photo_url, user_id))
        




        cursor.execute("""
            UPDATE blogger_applications
            SET channel_photo_url = ?
            WHERE user_id = ? AND status = 'approved'
        """, (photo_url, user_id))
        db.commit()
     
        
        return jsonify({
            'success': True,
            'photo_url': photo_url,
            'message': 'Фото успешно загружено'
        })
        




    except Exception as e:
        logger.error(f"Error in upload_blogger_photo: {str(e)}", exc_info=True)
        return jsonify({'error': ' ошибка сервера'}), 500












@app.route('/api/chat/messages/<int:blogger_id>', methods=['GET'])
@require_auth
def get_chat_messages(blogger_id):
 
    try:
        user_id = g.user.get('id')
        channel_id = request.args.get('channel_id', type=int)
        
        logger.info(f"GET_MESSAGES: user_id={user_id}, blogger_id={blogger_id}, channel_id={channel_id}")
        
        logger.info(f"🔍 GET /api/chat/messages/{blogger_id} - user_id={user_id}, channel_id={channel_id}")
        
        logger.info(f"🔍 GET /api/chat/messages/{blogger_id} - user_id={user_id}, channel_id={channel_id}")
        
        db = get_db()
        cursor = db.cursor()
        
     
        messages = ChatMessage.get_conversation(cursor, user_id, blogger_id, channel_id=channel_id)
        
      
        filtered_messages = []
        for message in messages:
          
            if message.get('message_type') == 'system_review' and message.get('metadata'):
                try:
                    metadata = json.loads(message['metadata']) if isinstance(message['metadata'], str) else message['metadata']
                    post_id = metadata.get('post_id')
                    review_type = metadata.get('review_type')
                    
                    # Проверяем, был ли уже оставлен отзыв
                    cursor.execute("""
                        SELECT id FROM reviews
                        WHERE post_id = ? AND reviewer_id = ? AND review_type = ?
                    """, (post_id, user_id, review_type))
                    
                    existing_review = cursor.fetchone()
                    
                    # Если отзыв уже был оставлен, пропускаем это сообщение
                    if existing_review:
                        continue
                        
                except Exception as e:
                    logger.error(f"Error checking review status: {str(e)}")
            
            filtered_messages.append(message)
        
    
        ChatMessage.mark_as_read(cursor, blogger_id, user_id, channel_id=channel_id)
        db.commit()
        
        return jsonify({
            'messages': filtered_messages,
            'count': len(filtered_messages)
        })
    except Exception as e:
        logger.error(f"Error getting chat messages: {str(e)}", exc_info=True)
        return jsonify({'error': 'ошибка сервера'}), 500


@app.route('/api/chat/messages', methods=['POST'])
@require_auth
def send_chat_message():

    try:
        user_id = g.user.get('id')
        data = request.json
        
        blogger_id = data.get('blogger_id')
        channel_id = data.get('channel_id')  
        message = data.get('message', '').strip()
        
    

        
        if not blogger_id:
            return jsonify({'error': 'ОШИБКА С АЙДИ'}), 400
        
        if not message:
            return jsonify({'error': 'Сообщение не может быть пустым'}), 400
        
        db = get_db()
        cursor = db.cursor()
        

        blogger = User.get_by_id(cursor, blogger_id)
        if not blogger:
            return jsonify({'error': 'Блогер не найден'}), 404
        

        message_id = ChatMessage.create(cursor, user_id, blogger_id, message, channel_id=channel_id)  # NEW: Pass channel_id
        db.commit()
        

        

        cursor.execute("""
            SELECT cm.*, 
                   u1.first_name as sender_first_name, 
                   u1.last_name as sender_last_name,
                   u1.username as sender_username
            FROM chat_messages cm
            LEFT JOIN users u1 ON cm.sender_id = u1.user_id
            WHERE cm.id = ?
        """, (message_id,))
        
        created_message = dict(cursor.fetchone())
        
        logger.info(f"Message sent: from={user_id} to={blogger_id}, id={message_id}")
        

        try:
            from telegram_bot import notify_user_about_new_message
            sender = User.get_by_id(cursor, user_id)
            
            run_async(notify_user_about_new_message(
                receiver_id=blogger_id,
                sender_id=user_id,
                sender_name=sender.get('username') or sender.get('first_name') or f"ID{user_id}",
                message_preview=message[:50]
            ))
            
            logger.info(f"Telegram notification sent to user {blogger_id}")
        except Exception as e:
            logger.error(f"Error sending Telegram notification: {e}")




        
        return jsonify({
            'success': True,
            'message': created_message
        })
        



    except Exception as e:
        logger.error(f"Error sending message: {str(e)}", exc_info=True)
        return jsonify({'error': ' ошибка сервера'}), 500


@app.route('/api/chat/unread', methods=['GET'])
@require_auth
def get_unread_count():

    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        
        unread_count = ChatMessage.get_unread_count(cursor, user_id)
        
        return jsonify({
            'unread_count': unread_count
        })
    except Exception as e:
        logger.error(f"Error getting unread count: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500











#Сделать список чатов завтра на странице чатов




@app.route('/api/chat/conversations', methods=['GET'])
@require_auth
def get_conversations():
 
    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        
        # Определяем тип текущего пользователя один раз
        cursor.execute("SELECT user_type FROM users WHERE user_id = ?", (user_id,))
        current_user_row = cursor.fetchone()
        current_user_type = current_user_row['user_type'] if current_user_row else 'buyer'
        
        # Get all unique conversations with last message, grouped by channel_id
        # ВАЖНО: Группируем по (contact_id, channel_id), чтобы один блогер с разными каналами давал разные чаты
        # channel_id может быть:
        # - NULL (старые сообщения без привязки)
        # - положительное число (ID из blogger_channels)
        # - отрицательное число (ID из blogger_applications, умноженный на -1)
        cursor.execute("""
            WITH last_messages AS (
                SELECT 
                    CASE 
                        WHEN sender_id = ? THEN receiver_id
                        ELSE sender_id
                    END as contact_id,
                    channel_id,
                    MAX(created_at) as last_message_time
                FROM chat_messages
                WHERE sender_id = ? OR receiver_id = ?
                GROUP BY contact_id, channel_id
            ),
            unread_counts AS (
                SELECT 
                    sender_id as contact_id,
                    channel_id,
                    COUNT(*) as unread_count
                FROM chat_messages
                WHERE receiver_id = ? AND is_read = 0
                GROUP BY sender_id, channel_id
            )
            SELECT 
                u.user_id,
                u.first_name,
                u.last_name,
                u.username,
                u.photo_url,
                u.blogger_photo_url,
                lm.last_message_time,
                lm.channel_id,
                COALESCE(uc.unread_count, 0) as unread_count,
                (
                    SELECT message 
                    FROM chat_messages 
                    WHERE ((sender_id = ? AND receiver_id = u.user_id) 
                       OR (sender_id = u.user_id AND receiver_id = ?))
                       AND (
                           (channel_id IS NULL AND lm.channel_id IS NULL) OR
                           (channel_id = lm.channel_id)
                       )
                    ORDER BY created_at DESC 
                    LIMIT 1
                ) as last_message,
                (
                    SELECT sender_id 
                    FROM chat_messages 
                    WHERE ((sender_id = ? AND receiver_id = u.user_id) 
                       OR (sender_id = u.user_id AND receiver_id = ?))
                       AND (
                           (channel_id IS NULL AND lm.channel_id IS NULL) OR
                           (channel_id = lm.channel_id)
                       )
                    ORDER BY created_at DESC 
                    LIMIT 1
                ) as last_message_sender_id,
                u.user_type,
                bc.channel_link,
                bc.channel_name,
                bc.channel_photo_url,
                ba.channel_link as app_channel_link
            FROM last_messages lm
            JOIN users u ON u.user_id = lm.contact_id
            LEFT JOIN unread_counts uc ON uc.contact_id = u.user_id AND (
                (uc.channel_id IS NULL AND lm.channel_id IS NULL) OR
                (uc.channel_id = lm.channel_id)
            )
            LEFT JOIN blogger_channels bc ON bc.id = lm.channel_id AND lm.channel_id > 0
            LEFT JOIN blogger_applications ba ON ba.id = -lm.channel_id AND lm.channel_id < 0
            ORDER BY lm.last_message_time DESC
        """, (user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id))
        
        conversations = []
        for row in cursor.fetchall():
            row_dict = dict(row)
            
        
            channel_username = None
            display_name = None
            
       
            if row_dict.get('channel_id'):  
                if row_dict['channel_id'] > 0:
                    channel_name = row_dict.get('channel_name', '')
                    channel_link = row_dict.get('channel_link', '')
                else:
                    channel_name = ''
                    channel_link = row_dict.get('app_channel_link', '')
                
                if channel_link:
                    import re
                    patterns = [
                        r't\.me/([^/\?]+)',
                        r'telegram\.me/([^/\?]+)',
                        r'@(\w+)'
                    ]
                    for pattern in patterns:
                        match = re.search(pattern, channel_link)
                        if match:
                            username = match.group(1)
                            if not username.startswith('@'):
                                username = '@' + username
                            channel_username = username
                            break
                
                if channel_username:
                    display_name = channel_username
                elif channel_name:
                    display_name = channel_name
            




     
            if not display_name:
                if row_dict['user_type'] == 'blogger':
                  


                    first_name = (row_dict.get('first_name') or '').strip()
                    last_name = (row_dict.get('last_name') or '').strip()

                    username = (row_dict.get('username') or '').strip().lstrip('@')
                    


                    if username:

                        display_name = f"@{username}"
                    elif first_name:
                        display_name = first_name
                    elif last_name:

                        display_name = last_name
                    else:

                        display_name = f"ID: {row_dict['user_id']}"
                else:
                  
                    first_name = (row_dict.get('first_name') or '').strip()
                    last_name = (row_dict.get('last_name') or '').strip()
                    username = (row_dict.get('username') or '').strip().lstrip('@')
                    
                    if first_name:

                        display_name = first_name
                    elif last_name:
                        display_name = last_name
                    elif username:

                        display_name = username
                    else:
                        display_name = f"ID: {row_dict['user_id']}"
            




            last_message_preview = row_dict['last_message'][:50] + '...' if row_dict['last_message'] and len(row_dict['last_message']) > 50 else row_dict['last_message']
            
       
            is_last_message_from_me = row_dict['last_message_sender_id'] == user_id
            if is_last_message_from_me:
                last_message_preview = f"Вы: {last_message_preview}"
            

            if row_dict.get('channel_photo_url'):
                photo_url = row_dict['channel_photo_url']
            elif row_dict['user_type'] == 'blogger' and row_dict.get('blogger_photo_url'):
                photo_url = row_dict['blogger_photo_url']
            else:
                photo_url = row_dict.get('photo_url')
            
   
            if not photo_url:
                photo_url = f"https://ui-avatars.com/api/?name={display_name}&background=2481cc&color=fff&size=200"
            
    
            final_channel_link = None
            if row_dict.get('channel_id'):
                if row_dict['channel_id'] > 0:
                    final_channel_link = row_dict.get('channel_link')
                else:
                    final_channel_link = row_dict.get('app_channel_link')
            
 
            buyer_name = None
            buyer_photo = None
            channel_avatar = None
            
            if current_user_type == 'blogger':
           #получатель для блогера!!!!!!!!!!!!!!!!!!!!!
                first_name = (row_dict.get('first_name') or '').strip()
                last_name = (row_dict.get('last_name') or '').strip()
                
                if first_name:
                    buyer_name = first_name
                elif last_name:
                    buyer_name = last_name
                else:
                    buyer_name = row_dict.get('username', f"ID: {row_dict['user_id']}")
                
          
                buyer_photo = row_dict.get('photo_url')
                if not buyer_photo:
                    buyer_photo = f"https://ui-avatars.com/api/?name={buyer_name}&background=2481cc&color=fff&size=200"
                
       
                if row_dict.get('channel_photo_url'):
                    channel_avatar = row_dict['channel_photo_url']
            


            conversations.append({
                'user_id': row_dict['user_id'],
                'channel_id': row_dict.get('channel_id'),  
                'name': display_name,
                'photo_url': photo_url,

                'buyer_name': buyer_name,  

                'buyer_photo': buyer_photo,  

                'channel_avatar': channel_avatar,  
                'last_message': last_message_preview,
                'last_message_time': row_dict['last_message_time'],
                'unread_count': row_dict['unread_count'],
                'channel_link': final_channel_link
            })
        

        return jsonify({
            'conversations': conversations,
            'count': len(conversations)
        })
        
    except Exception as e:
        logger.error(f"Error getting conversations: {str(e)}", exc_info=True)
        return jsonify({'error': 'ошибка сервера'}), 500




@app.route('/api/referrals', methods=['GET'])
@require_auth
def get_referrals():
    

    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()

        cursor.execute("""
            SELECT 
                user_id,
                first_name,
                last_name,
                username,
                photo_url,
                referral_commission_generated
            FROM users
            WHERE referrer_id = ?
            ORDER BY created_at DESC
        """, (user_id,))






        rows = cursor.fetchall() or []





        referrals = []

        for row in rows:

            first_name = (row.get('first_name') or '').strip()
            last_name = (row.get('last_name') or '').strip()
            username = (row.get('username') or '').strip().lstrip('@')

            if first_name:

                display_name = f"{first_name} {last_name}".strip()
            elif username:
                display_name = f"@{username}"
            else:
                display_name = f"ID: {row.get('user_id')}"

            referrals.append({
                'user_id': row.get('user_id'),
                'display_name': display_name,
                'username': username,
                'photo_url': row.get('photo_url') or '',
                'total_commission': float(row.get('referral_commission_generated') or 0.0),
            })

        return jsonify({
            'referrals': referrals,
            'count': len(referrals)
        })
    except Exception as e:
        logger.error(f"Error getting referrals: {str(e)}", exc_info=True)
        return jsonify({'error': 'ошибка сервера'}), 500




@app.route('/api/ad_posts/create', methods=['POST'])
@require_auth
def create_ad_post():

    try:
        user_id = g.user.get('id')
        
   
        data = request.form
        
        
        blogger_id = data.get('blogger_id')
        channel_id = data.get('channel_id')  
        post_text = data.get('post_text', '').strip()
        scheduled_time = data.get('scheduled_time')
        duration_hours = data.get('duration_hours')
        
        if not blogger_id:
            logger.error("Missing blogger_id in request")
            return jsonify({'error': 'ID блогера не указан'}), 400
        
        if not duration_hours:

            logger.error("Missing duration_hours in request")
            return jsonify({'error': 'Продолжительность размещения не указана'}), 400
        
        if not scheduled_time:

            logger.error("Missing scheduled_time in request")
            return jsonify({'error': 'Время публикации не указано'}), 400
        


        try:
            blogger_id = int(blogger_id)

            if channel_id:

                channel_id = int(channel_id)
            else:
                channel_id = None

            duration_hours = int(duration_hours)



        except (ValueError, TypeError) as e:

            logger.error(f"Error converting data types: {e}")
            return jsonify({'error': 'Некорректный формат данных'}), 400
        
      
        if not all([blogger_id, post_text, scheduled_time, duration_hours > 0]):

            return jsonify({'error': 'Некорректные данные поста'}), 400
        
        db = get_db()
        cursor = db.cursor()
        
  
        blogger = User.get_by_id(cursor, blogger_id)
        if not blogger or blogger.get('user_type') != 'blogger':
            return jsonify({'error': 'Блогер не найден'}), 404
        

        channel_dict = None
        if channel_id:
            cursor.execute("""
                SELECT * FROM blogger_channels 
                WHERE id = ? AND user_id = ? AND is_active = 1
            """, (channel_id, blogger_id))
            channel = cursor.fetchone()
            if not channel:
                return jsonify({'error': 'Канал не найден или неактивен'}), 404
            channel_dict = dict(channel)
        else:
           
            cursor.execute("""
                SELECT * FROM blogger_channels 
                WHERE user_id = ? AND is_active = 1 
                AND (price IS NOT NULL AND price != '')
                ORDER BY id ASC
                LIMIT 1
            """, (blogger_id,))
            channel = cursor.fetchone()
            if channel:
                channel_dict = dict(channel)
                channel_id = channel_dict.get('id')
                logger.info(f"No channel_id provided, using first active channel: {channel_id}")
        
      
        if channel_dict:


           
            channel_price_str = channel_dict.get('price') or None
            if channel_price_str and str(channel_price_str).strip():

                channel_price_str = str(channel_price_str).strip()
            else:

                channel_price_str = blogger.get('blogger_price', '0')
            
            channel_price_permanent_str = channel_dict.get('price_permanent') or None

            if channel_price_permanent_str and str(channel_price_permanent_str).strip():
                channel_price_permanent_str = str(channel_price_permanent_str).strip()


            else:
                channel_price_permanent_str = blogger.get('blogger_price_permanent', '')
        else:
            channel_price_str = blogger.get('blogger_price', '0')

            channel_price_permanent_str = blogger.get('blogger_price_permanent', '')
        
        logger.info(f"Price calculation: channel_id={channel_id}, channel_price_str='{channel_price_str}', channel_price_permanent_str='{channel_price_permanent_str}'")
        
        try:
            blogger_price_12h = float(channel_price_str) if channel_price_str else 0.0
            if blogger_price_12h <= 0:
                logger.error(f"Invalid channel/blogger price: {channel_price_str} (must be > 0)")
                return jsonify({'error': 'Цена канала не установлена или некорректна'}), 400
        except (ValueError, TypeError) as e:
            logger.error(f"Invalid channel/blogger price: {channel_price_str}, error: {e}")


            return jsonify({'error': 'Некорректная цена канала'}), 500
        
  
        blogger_price_permanent = None


        if channel_price_permanent_str:
            try:
                blogger_price_permanent = float(channel_price_permanent_str)
            except (ValueError, TypeError):


                logger.warning(f"Invalid permanent price: {channel_price_permanent_str}")
                blogger_price_permanent = None
        
   
   
        if duration_hours == -1 and not blogger_price_permanent:
            return jsonify({'error': 'Блогер не установил цену для постоянного размещения'}), 400
        
      
        is_offer_raw = data.get('is_offer', '0')
        is_offer = str(is_offer_raw).lower() in ('1', 'true', 'yes')
        offer_base_price_str = data.get('offer_base_price')
        offer_price_12h = None

        if offer_base_price_str:

            try:
                offer_price_12h = float(offer_base_price_str)

            except (ValueError, TypeError):
                logger.warning(f"Invalid offer_base_price: {offer_base_price_str}")
                offer_price_12h = None
        
        effective_price_12h = blogger_price_12h
        
        if is_offer and offer_price_12h is not None and offer_price_12h > 0:
          
            min_allowed_12h = blogger_price_12h * 0.5
            if offer_price_12h < min_allowed_12h:
                logger.warning(
                    f"Offer price too low: {offer_price_12h} < 50% of base {blogger_price_12h} "
                    f"for blogger_id={blogger_id}"
                )
                return jsonify({'error': 'Нельзя предложить цену ниже 50% от цены блогера'}), 400
            
            effective_price_12h = offer_price_12h
        
  
        if duration_hours == -1:
           
            price = blogger_price_permanent if blogger_price_permanent else effective_price_12h * 10
        else:
            price = (effective_price_12h / 12) * duration_hours
        
        logger.info(
            f"Calculated price: {price} (base_12h={effective_price_12h}, "
            f"blogger_base_12h={blogger_price_12h}, blogger_permanent={blogger_price_permanent}, "
            f"duration={duration_hours}h, is_offer={is_offer})"
        )
        
 
        user = User.get_by_id(cursor, user_id)
        if user['balance'] < price:
            return jsonify({'error': 'Недостаточно средств на балансе'}), 400
        
      
        from datetime import datetime, timedelta
        
      
        try:
            scheduled_dt = datetime.fromisoformat(scheduled_time.replace('T', ' '))
        except ValueError:
            try:
                scheduled_dt = datetime.strptime(scheduled_time, '%Y-%m-%d %H:%M')
            except ValueError:
                logger.error(f"Invalid scheduled_time format: {scheduled_time}")
                return jsonify({'error': 'Некорректный формат времени публикации'}), 400
        
 
        window_start_dt = scheduled_dt - timedelta(hours=1)
        window_end_dt = scheduled_dt + timedelta(hours=1)
        window_start = window_start_dt.strftime('%Y-%m-%d %H:%M:%S')
        window_end = window_end_dt.strftime('%Y-%m-%d %H:%M:%S')
        
        cursor.execute(
            """
            SELECT id, scheduled_time, status
            FROM ad_posts
            WHERE blogger_id = ?
              AND status IN ('pending', 'approved')
              AND scheduled_time BETWEEN ? AND ?
            ORDER BY scheduled_time ASC
            """,
            (blogger_id, window_start, window_end)
        )
        conflict = cursor.fetchone()
        if conflict:
            logger.info(
                "Time slot conflict for blogger %s: requested=%s, "
                "window=[%s, %s], existing_post_id=%s, existing_time=%s, status=%s",
                blogger_id,
                scheduled_time,
                window_start,
                window_end,
                conflict.get('id'),
                conflict.get('scheduled_time'),
                conflict.get('status'),
            )
            return jsonify({
                'error': 'Это время занято, выберите другое время',
                'code': 'TIME_SLOT_OCCUPIED'
            }), 400
        

        if duration_hours == -1:
            delete_dt = scheduled_dt + timedelta(days=36500) 
        else:
            delete_dt = scheduled_dt + timedelta(hours=duration_hours)
        
       
        scheduled_time_db = scheduled_dt.strftime('%Y-%m-%d %H:%M:%S')
        delete_time_db = delete_dt.strftime('%Y-%m-%d %H:%M:%S')
        
        logger.info(f"Scheduled time: {scheduled_time_db}, Delete time: {delete_time_db}, Duration: {duration_hours}h")
        
  
        post_images = []
        if request.files:
            upload_folder = os.path.join('static', 'uploads', 'ad_posts')
            os.makedirs(upload_folder, exist_ok=True)
            
            for key in request.files:
                file = request.files[key]
                if file and file.filename:
         
                    import uuid
                    file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'jpg'
                    filename = f"post_{user_id}_{uuid.uuid4().hex}.{file_ext}"
                    file_path = os.path.join(upload_folder, filename)
                    file.save(file_path)
                    post_images.append(f"/static/uploads/ad_posts/{filename}")
        
 
        import json
        post_images_json = json.dumps(post_images)
        
      
        is_premium_post_raw = data.get('is_premium_post', '0')
        is_premium_post = str(is_premium_post_raw).lower() in ('1', 'true', 'yes')
        premium_message_id = None
        premium_chat_id = None
        
        if is_premium_post:
            try:
                premium_message_id = int(data.get('premium_message_id')) if data.get('premium_message_id') else None
                premium_chat_id = int(data.get('premium_chat_id')) if data.get('premium_chat_id') else None
                logger.info(f"Premium post data: message_id={premium_message_id}, chat_id={premium_chat_id}")
            except (ValueError, TypeError) as e:
                logger.warning(f"Invalid premium post data: {e}")
                is_premium_post = False
        





        # Create ad post
        post_id = AdPost.create(
            cursor, user_id, blogger_id, post_text, 
            post_images_json, scheduled_time_db, delete_time_db, price,
            created_from_offer=0, channel_id=channel_id,
            is_premium_post=is_premium_post, premium_message_id=premium_message_id, premium_chat_id=premium_chat_id
        )
        
 







        from database.escrow_model import EscrowTransaction
        EscrowTransaction.create_table(cursor)
        

        User.update_balance(cursor, user_id, price, 'subtract')
        
   #змрзка
        EscrowTransaction.hold_funds(
            cursor=cursor,
            ad_post_id=post_id,
            buyer_id=user_id,
            blogger_id=blogger_id,
            amount=price,
            commission_rate=0.10
        )
        
        db.commit()
        
        logger.info(f"Ad post created: id={post_id}, buyer={user_id}, blogger={blogger_id}, price={price}, duration={duration_hours}h")
        

        created_post = AdPost.get_by_id(cursor, post_id)


        try:
            from telegram_bot import notify_about_ad_post_payment

            run_async(
                notify_about_ad_post_payment(
                    buyer_id=user_id,
                    blogger_id=blogger_id,
                    price=price,
                    post_id=post_id,
                    scheduled_time=scheduled_time_db,
                    is_offer=is_offer,
                    channel_id=channel_id 
                )
            )
            logger.info(f"Telegram notifications about ad post payment sent (post_id={post_id}, channel_id={channel_id})")
        except Exception as e:
            logger.error(f"Error sending Telegram notifications for ad post {post_id}: {e}", exc_info=True)
        
        return jsonify({
            'success': True,
            'post_id': post_id,
            'post': created_post,
            'message': 'Рекламный пост отправлен блогеру на модерацию'
        })
        
    except Exception as e:
        logger.error(f"Error creating ad post: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500


@app.route('/api/offers/my', methods=['GET'])
@require_auth
def get_my_offers():

    try:
        db = get_db()
        cursor = db.cursor()
        

        offers = Offer.get_all_offers(cursor, limit=100)
        
        # Небольшое форматирование под фронтенд
        for offer in offers:
            try:
                offer['hour_price'] = float(offer.get('hour_price') or 0.0)
                offer['duration_hours'] = int(offer.get('duration_hours') or 0)
            except (TypeError, ValueError):
                pass
        return jsonify({'offers': offers})
    except Exception as e:
        logger.error(f"Error getting offers for user: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500


@app.route('/api/premium_post/start', methods=['POST'])
@require_auth
def start_premium_post_session():

    try:
        user_id = g.user.get('id')
        data = request.get_json()
        session_id = data.get('session_id')
        
        if not session_id:
            return jsonify({'error': 'session_id is required'}), 400
        
        logger.info(f"Starting premium post session for user {user_id}, session_id={session_id}")
        
  
        conn = get_db()
        cursor = conn.cursor()
        
 
        cursor.execute("""
            INSERT INTO premium_post_sessions (user_id, session_id, status, created_at)
            VALUES (?, ?, 'waiting', CURRENT_TIMESTAMP)
        """, (user_id, session_id))
        
        conn.commit()
        conn.close()
        
        # Отправляем сообщение боту для начала FSM
        import requests as req
        bot_token = os.environ.get('TELEGRAM_BOT_TOKEN', 'ТУТтокен')
        

        bot_api_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": user_id,
            "text": (
                "📝 <b>Отправьте текст рекламного поста</b>\n\n"
                "Вы можете:\n"
                "• Форматировать слова (жирный, курсив)\n"
                "• Добавлять ссылки\n"
                "• Использовать премиум-эмодзи\n"
                "• Прикрепить до 5 картинок\n\n"
                "<i>У вас есть 5 минут для отправки поста</i>"
            ),
            "parse_mode": "HTML",
            "reply_markup": json.dumps({
                "inline_keyboard": [[
                    {"text": "❌ Отмена", "callback_data": f"cancel_premium_post:{session_id}"}
                ]]
            })
        }
        
        response = req.post(bot_api_url, json=payload, timeout=10)
        
        if not response.ok:
            logger.error(f"Failed to send message to bot: {response.text}")
            return jsonify({'error': 'Failed to notify bot'}), 500
        
        # Устанавливаем FSM состояние через внутренний API бота
        # Это требует запущенного бота с поддержкой FSM
        try:

            bot_internal_url = "http://localhost:7777/bot/set_fsm_state"
            fsm_payload = {
                "user_id": user_id,
                "state": "PremiumPostStates:waiting_for_post_content",
                "data": {
                    "session_id": session_id,
                    "created_at": datetime.now().isoformat()
                }
            }
            fsm_response = req.post(bot_internal_url, json=fsm_payload, timeout=5)
            logger.info(f"✅ FSM state set via internal API: {fsm_response.status_code}")
        except Exception as e:
            logger.warning(f"Could not set FSM state via internal API: {e}")
        
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'message': 'Session started, please send post to bot'
        })
        
    except Exception as e:
        logger.error(f"Error starting premium post session: {e}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500




@app.route('/api/premium_post/status', methods=['GET'])
@require_auth
def get_premium_post_status():
    
    try:
        user_id = g.user.get('id')

        session_id = request.args.get('session_id')
        

        if not session_id:

            return jsonify({'error': 'session_id is required'}), 400
        


        conn = get_db()

        cursor = conn.cursor()
        
    
        cursor.execute("""
            SELECT * FROM premium_posts
            WHERE user_id = ? AND session_id = ? AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT 1
        """, (user_id, session_id))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:

            post_data = dict(row)
            return jsonify({
                'status': 'received',
                'post_id': post_data['id'],
                'post_text': post_data['post_text'],
                'post_images': json.loads(post_data.get('post_images', '[]')),
                'telegram_message_id': post_data.get('telegram_message_id'),
                'telegram_chat_id': post_data.get('telegram_chat_id')
            })


        else:
            return jsonify({
                'status': 'waiting'
            })
        
    except Exception as e:
        logger.error(f"Error checking premium post status: {e}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/offers/create', methods=['POST'])
@require_auth
def create_offer():

    try:
        user_id = g.user.get('id')
        
        logger.info(f"Creating offer from user_id={user_id}")
        logger.info(f"Offer form keys: {list(request.form.keys())}")
        logger.info(f"Offer files keys: {list(request.files.keys())}")
        
        data = request.form
        text = (data.get('text') or '').strip()
        hour_price_raw = data.get('hour_price')
        duration_hours_raw = data.get('duration_hours')
        topic = (data.get('topic') or '').strip()
        
        if not text:
            return jsonify({'error': 'Текст предложения обязателен'}), 400
        
        try:
            hour_price = float(hour_price_raw)
        except (TypeError, ValueError):
            return jsonify({'error': 'Некорректная цена за час'}), 400
        
        try:
            duration_hours = int(duration_hours_raw)
        except (TypeError, ValueError):
            return jsonify({'error': 'Некорректный срок поста'}), 400
        
        if hour_price <= 0:
            return jsonify({'error': 'Цена за час должна быть больше нуля'}), 400
        if duration_hours <= 0 or duration_hours > 24:
            return jsonify({'error': 'Срок поста должен быть от 1 до 24 часов'}), 400
        
     
        offer_images = []
        if request.files:
            upload_folder = os.path.join('static', 'uploads', 'offers')
            os.makedirs(upload_folder, exist_ok=True)
            
            for key in request.files:
                file = request.files[key]
                if file and file.filename:
                    import uuid
                    file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'jpg'
                    filename = f"offer_{user_id}_{uuid.uuid4().hex}.{file_ext}"
                    file_path = os.path.join(upload_folder, filename)
                    file.save(file_path)
                    offer_images.append(f"/static/uploads/offers/{filename}")
        
        images_json = json.dumps(offer_images)
        
        db = get_db()
        cursor = db.cursor()
        
        offer_id = Offer.create(
            cursor,
            user_id=user_id,
            text=text,
            images_json=images_json,
            hour_price=hour_price,
            topic=topic,
            duration_hours=duration_hours
        )
        
        db.commit()
        
        created_offer = Offer.get_by_id(cursor, offer_id)
        
        logger.info(f"Offer created: id={offer_id}, user_id={user_id}, hour_price={hour_price}, duration={duration_hours}h")
        
        return jsonify({
            'success': True,
            'offer': created_offer
        })
    except Exception as e:
        logger.error(f"Error creating offer: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500


@app.route('/api/offers/<int:offer_id>/propose_publication', methods=['POST'])
@require_auth
def propose_offer_publication(offer_id):
    pass


@app.route('/api/offers/<int:offer_id>/delete', methods=['DELETE'])
@require_auth
def delete_offer(offer_id):
 
    try:
        user_id = g.user.get('id')
        
        logger.info(f"Deleting offer id={offer_id} by user_id={user_id}")
        
        db = get_db()
        cursor = db.cursor()
        
      
        offer = Offer.get_by_id(cursor, offer_id)
        if not offer:
            return jsonify({'error': 'Оффер не найден'}), 404
        
        if offer.get('user_id') != user_id:
            return jsonify({'error': 'У вас нет прав на удаление этого оффера'}), 403
        

        cursor.execute('DELETE FROM offers WHERE id = ?', (offer_id,))
        db.commit()
        
        logger.info(f"Offer deleted: id={offer_id}, user_id={user_id}")
        
        return jsonify({
            'success': True,
            'message': 'Оффер успешно удалён'
        })

    except Exception as e:

        logger.error(f"Error deleting offer: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500

    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()

     
        user = User.get_by_id(cursor, user_id)
        if not user or user.get('user_type') != 'blogger':
            return jsonify({
                'error': 'Вы не можете продавать посты, так как не являетесь блогером'
            }), 403

    
        offer = Offer.get_by_id(cursor, offer_id)
        if not offer:
            return jsonify({'error': 'Предложение не найдено'}), 404

        data = request.json or {}
        scheduled_time = (data.get('scheduled_time') or '').strip()
        channel_id = data.get('channel_id') 

        if not scheduled_time:
            return jsonify({'error': 'Время публикации не указано'}), 400
        
        if not channel_id:
            return jsonify({'error': 'Канал не указан'}), 400

        from datetime import datetime

       
        try:
            scheduled_dt = datetime.fromisoformat(scheduled_time.replace('T', ' '))
        except ValueError:


            try:
                scheduled_dt = datetime.strptime(scheduled_time, '%Y-%m-%d %H:%M')
            except ValueError:
                logger.error(f"Invalid scheduled_time format in propose_offer_publication: {scheduled_time}")
                return jsonify({'error': 'Некорректный формат времени публикации'}), 400

        scheduled_db = scheduled_dt.strftime('%Y-%m-%d %H:%M:%S')


        proposal_id = OfferPublication.create(cursor, offer_id, user_id, scheduled_db, channel_id=channel_id) 
        db.commit()



        logger.info(
            f"Offer publication proposed: proposal_id={proposal_id}, offer_id={offer_id}, "
            f"blogger_id={user_id}, channel_id={channel_id}, scheduled_time={scheduled_db}"
        )



        return jsonify({
            'success': True,
            'proposal_id': proposal_id,
            'message': 'Предложение публикации сохранено'
        })




    except Exception as e:
        logger.error(f"Error in propose_offer_publication: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500





















@app.route('/api/ad_posts/chat/<int:partner_id>', methods=['GET'])
@require_auth
def get_ad_posts_for_chat(partner_id):

    try:
        user_id = g.user.get('id')
        channel_id = request.args.get('channel_id', type=int) 
        db = get_db()
        cursor = db.cursor()
        
        logger.info(f"Getting ad posts for chat: user_id={user_id}, partner_id={partner_id}, channel_id={channel_id}")
     
        if channel_id:
            cursor.execute("""
                SELECT ap.*,
                       u.first_name as buyer_first_name,
                       u.last_name as buyer_last_name,
                       u.username as buyer_username
                FROM ad_posts ap
                LEFT JOIN users u ON ap.buyer_id = u.user_id
                WHERE (
                        (ap.buyer_id = ? AND ap.blogger_id = ?)
                     OR (ap.buyer_id = ? AND ap.blogger_id = ?)
                  )
                  AND ap.channel_id = ?
                ORDER BY ap.created_at ASC
            """, (user_id, partner_id, partner_id, user_id, channel_id))
        else:
            # Если channel_id не передан, показываем только посты без channel_id (для обратной совместимости)
            cursor.execute("""
                SELECT ap.*,
                       u.first_name as buyer_first_name,
                       u.last_name as buyer_last_name,
                       u.username as buyer_username
                FROM ad_posts ap
                LEFT JOIN users u ON ap.buyer_id = u.user_id
                WHERE (
                        (ap.buyer_id = ? AND ap.blogger_id = ?)
                     OR (ap.buyer_id = ? AND ap.blogger_id = ?)
                  )
                  AND ap.channel_id IS NULL
                ORDER BY ap.created_at ASC
            """, (user_id, partner_id, partner_id, user_id))
        
        rows = cursor.fetchall() or []
        
        # Преобразуем в словари, распарсим изображения и вычислим, был ли заказ оффером
        import json
        from datetime import datetime
        posts = []
        for row in rows:
            post = dict(row)
            try:
                post['post_images'] = json.loads(post.get('post_images', '[]'))
            except Exception:
                post['post_images'] = []
            
            # Пытаемся определить, был ли заказ оффером:
            # сравниваем эффективную цену за 24 часа с текущей базовой ценой блогера.
            try:
                scheduled_raw = str(post.get('scheduled_time') or '')
                delete_raw = str(post.get('delete_time') or '')
                price_val = float(post.get('price') or 0)
                
                if scheduled_raw and delete_raw and price_val > 0:
                    try:
                        scheduled_dt = datetime.fromisoformat(scheduled_raw.replace('T', ' '))
                    except ValueError:
                        scheduled_dt = datetime.strptime(scheduled_raw, '%Y-%m-%d %H:%M:%S')
                    
                    try:
                        delete_dt = datetime.fromisoformat(delete_raw.replace('T', ' '))
                    except ValueError:
                        delete_dt = datetime.strptime(delete_raw, '%Y-%m-%d %H:%M:%S')
                    
                    delta_hours = (delete_dt - scheduled_dt).total_seconds() / 3600.0
                    
                    if delta_hours > 0:
                        effective_price_24h = (price_val * 24.0) / delta_hours
                        
                        # Получаем текущую базовую цену блогера
                        blogger = User.get_by_id(cursor, post.get('blogger_id'))
                        blogger_price_str = blogger.get('blogger_price') if blogger else None
                        blogger_price_24h = float(blogger_price_str) if blogger_price_str else None
                        
                        if blogger_price_24h and blogger_price_24h > 0:
                            # Если эффективная цена заметно отличается от базовой — считаем, что это оффер
                            if abs(effective_price_24h - blogger_price_24h) > 0.01:
                                post['is_offer'] = True
                            else:
                                post['is_offer'] = False
            except Exception as calc_err:
                logger.warning(f"Error detecting offer flag for ad post {post.get('id')}: {calc_err}")
            
            posts.append(post)
        
        logger.info(f"Found {len(posts)} ad posts for this chat (user_id={user_id}, partner_id={partner_id}, channel_id={channel_id})")
        if posts:
            post_ids = [p.get('id') for p in posts]
            logger.info(f"Post IDs: {post_ids}")
        
        return jsonify({
            'posts': posts,
            'count': len(posts)
        })
        
    except Exception as e:
        logger.error(f"Error getting ad posts for chat: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500
















@app.route('/api/ad_posts/pending', methods=['GET'])
@require_auth
def get_pending_ad_posts():
  
    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        
       
        user = User.get_by_id(cursor, user_id)
        if not user or user.get('user_type') != 'blogger':
            return jsonify({'posts': [], 'count': 0})
        
    
        posts = AdPost.get_pending_posts_for_blogger(cursor, user_id)
        
  
        import json
        for post in posts:
            try:
                post['post_images'] = json.loads(post.get('post_images', '[]'))
            except:
                post['post_images'] = []
        
        return jsonify({
            'posts': posts,
            'count': len(posts)
        })
        
    except Exception as e:
        logger.error(f"Error getting pending ad posts: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500








@app.route('/api/ad_posts/check_slot', methods=['GET'])
@require_auth
def check_ad_post_slot():

    try:
        blogger_id = request.args.get('blogger_id', type=int)
        scheduled_time = request.args.get('scheduled_time', type=str)

        if not blogger_id or not scheduled_time:
            return jsonify({'error': 'Не указан blogger_id или время публикации'}), 400

        from datetime import datetime, timedelta

        try:
            scheduled_dt = datetime.fromisoformat(scheduled_time.replace('T', ' '))
        except ValueError:
            try:
                scheduled_dt = datetime.strptime(scheduled_time, '%Y-%m-%d %H:%M')
            except ValueError:
                logger.error(f"Invalid scheduled_time format in check_slot: {scheduled_time}")
                return jsonify({'error': 'Некорректный формат времени публикации'}), 400

        window_start_dt = scheduled_dt - timedelta(hours=1)
        window_end_dt = scheduled_dt + timedelta(hours=1)
        window_start = window_start_dt.strftime('%Y-%m-%d %H:%M:%S')
        window_end = window_end_dt.strftime('%Y-%m-%d %H:%M:%S')

        db = get_db()
        cursor = db.cursor()

        cursor.execute(
            """
            SELECT id, scheduled_time, status
            FROM ad_posts
            WHERE blogger_id = ?
              AND status IN ('pending', 'approved')
              AND scheduled_time BETWEEN ? AND ?
            ORDER BY scheduled_time ASC
            """,
            (blogger_id, window_start, window_end)
        )
        conflict = cursor.fetchone()

        if conflict:
            logger.info(
                "Time slot check: OCCUPIED for blogger %s, requested=%s, "
                "window=[%s, %s], existing_post_id=%s, existing_time=%s, status=%s",
                blogger_id,
                scheduled_time,
                window_start,
                window_end,
                conflict.get('id'),
                conflict.get('scheduled_time'),
                conflict.get('status'),
            )
            return jsonify({
                'available': False,
                'message': 'Это время занято, выберите другое время'
            })

        logger.info(
            "Time slot check: FREE for blogger %s, requested=%s, window=[%s, %s]",
            blogger_id,
            scheduled_time,
            window_start,
            window_end,
        )
        return jsonify({'available': True})



    except Exception as e:
        logger.error(f"Error checking ad post slot: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500






@app.route('/api/ad_posts/<int:post_id>/cancel', methods=['POST'])
@require_auth
def cancel_ad_post(post_id):

    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()

  
        post = AdPost.get_by_id(cursor, post_id)
        if not post:
            return jsonify({'error': 'Пост не найден'}), 404

      
        if post['buyer_id'] != user_id:
            return jsonify({'error': 'Доступ запрещён'}), 403

     
        if post['status'] != 'pending':
            return jsonify({'error': 'Нельзя отменить этот заказ'}), 400

     
        AdPost.update_status(cursor, post_id, 'cancelled')

        
        from database.escrow_model import EscrowTransaction
        refund_info = EscrowTransaction.refund_to_buyer(cursor, post_id)
        
        if not refund_info:
         
            User.update_balance(cursor, post['buyer_id'], post['price'], 'add')
            logger.warning(f"⚠️ Escrow не найден для поста {post_id}, сделан прямой возврат")

        db.commit()

        logger.info(f"Ad post cancelled: id={post_id}, buyer={user_id}, refund={post['price']}")

    
        try:
            from telegram_bot import notify_about_ad_post_cancelled

            run_async(
                notify_about_ad_post_cancelled(
                    buyer_id=post['buyer_id'],
                    blogger_id=post['blogger_id'],
                    price=post['price'],
                    post_id=post_id,
                    channel_id=post.get('channel_id') 
                )
            )
        except Exception as e:
            logger.error(f"Error sending Telegram notifications for cancelled ad post {post_id}: {e}", exc_info=True)

        return jsonify({
            'success': True,
            'message': 'Заказ отменён, средства возвращены на баланс'
        })

    except Exception as e:
        logger.error(f"Error cancelling ad post: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500




@app.route('/api/ad_posts/<int:post_id>/approve', methods=['POST'])
@require_auth
def approve_ad_post(post_id):
 
    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        
      
        post = AdPost.get_by_id(cursor, post_id)
        if not post:
            return jsonify({'error': 'Пост не найден'}), 404
        
      
        if post['blogger_id'] != user_id:
            return jsonify({'error': 'Доступ запрещён'}), 403

      
        if post['status'] != 'pending':
            return jsonify({'error': 'Этот пост уже обработан'}, 400)

      
        commission_rate = 0.10  
        total_price = float(post['price'])

     
        AdPost.update_status(cursor, post_id, 'approved')

        

        User.update_stats(cursor, post['buyer_id'], total_orders=1, total_spent=total_price)
        Order.create(
            cursor,
            post['buyer_id'],
            'ad_post',
            f'Рекламный пост у блогера ID{post["blogger_id"]}',
            (post.get('post_text') or '')[:100],
            total_price
        )

        db.commit()

        logger.info(
            f"Ad post approved: id={post_id}, blogger={user_id}, "
            f"total_price={total_price}, средства остаются в escrow до удаления поста"
        )




        # Telegram notifications
        try:
            from telegram_bot import notify_about_ad_post_approved

            run_async(
                notify_about_ad_post_approved(
                    buyer_id=post['buyer_id'],
                    blogger_id=post['blogger_id'],
                    price=total_price,
                    blogger_amount=total_price * 0.9,  # Для уведомления показываем сумму после комиссии
                    commission_amount=total_price * 0.1,
                    post_id=post_id,
                    scheduled_time=str(post['scheduled_time']),
                    channel_id=post.get('channel_id')  # NEW: Pass channel_id
                )
            )








        except Exception as e:
            logger.error(f"Error sending Telegram notifications for approved ad post {post_id}: {e}", exc_info=True)

        return jsonify({
            'success': True,
            'message': 'Пост одобрен, средства начислены блогеру'
        })
        
    except Exception as e:
        logger.error(f"Error approving ad post: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500







@app.route('/api/ad_posts/<int:post_id>/reject', methods=['POST'])
@require_auth
def reject_ad_post(post_id):

    try:
        user_id = g.user.get('id')
        db = get_db()
        cursor = db.cursor()
        
      
        post = AdPost.get_by_id(cursor, post_id)
        if not post:
            return jsonify({'error': 'Пост не найден'}), 404
        
      
        if post['blogger_id'] != user_id:
            return jsonify({'error': 'Доступ запрещён'}), 403

     
        if post['status'] != 'pending':
            return jsonify({'error': 'Этот пост уже обработан'}, 400)

 
        AdPost.update_status(cursor, post_id, 'rejected')
        
  
        from database.escrow_model import EscrowTransaction
        refund_info = EscrowTransaction.refund_to_buyer(cursor, post_id)
        
        if not refund_info:
            User.update_balance(cursor, post['buyer_id'], post['price'], 'add')
            logger.warning(f"⚠️ Escrow не найден для поста {post_id}, сделан прямой возврат")



        
        db.commit()
        




        logger.info(f"Ad post rejected: id={post_id}, blogger={user_id}, refund={post['price']}")


        try:
            from telegram_bot import notify_about_ad_post_rejected

            run_async(
                notify_about_ad_post_rejected(
                    buyer_id=post['buyer_id'],
                    blogger_id=post['blogger_id'],
                    price=post['price'],
                    post_id=post_id,
                    channel_id=post.get('channel_id')  
                )
            )
        except Exception as e:
            logger.error(f"Error sending Telegram notifications for rejected ad post {post_id}: {e}", exc_info=True)
        
        return jsonify({
            'success': True,
            'message': 'Пост отклонён, средства возвращены покупателю'
        })
        
    except Exception as e:
        logger.error(f"Error rejecting ad post: {str(e)}", exc_info=True)
        return jsonify({'error': 'Внутренняя ошибка сервера'}), 500


@app.route('/api/blogger/<int:blogger_id>/reviews', methods=['GET'])
@require_auth
def get_blogger_reviews(blogger_id):

    try:
        logger.info(f"🔍 Getting reviews for blogger_id: {blogger_id}")
        
        db = get_db()
        cursor = db.cursor()
        
   
        cursor.execute("""
            SELECT r.id, r.rating, r.review_text, r.created_at,
                   u.user_id as reviewer_id, u.first_name, u.last_name, 
                   u.username, u.photo_url
            FROM reviews r
            LEFT JOIN users u ON r.reviewer_id = u.user_id
            WHERE r.reviewed_id = ? AND r.review_type = 'blogger'
            ORDER BY r.created_at DESC
        """, (blogger_id,))
        
        reviews = []
        rows = cursor.fetchall()
        
  

        
        for row in rows:
    
            first_name = row.get('first_name', '')
            last_name = row.get('last_name', '')
            reviewer_name = f"{first_name} {last_name}".strip()
            
        
            if not reviewer_name:
                username = row.get('username')
                if username:
                    reviewer_name = f"@{username}"
                else:
                    reviewer_name = f"User {row.get('reviewer_id')}"
            

            avatar_url = row.get('photo_url')
            if not avatar_url:
                avatar_url = f"https://ui-avatars.com/api/?name={reviewer_name}&background=3b82f6&color=fff&size=80"
            
            review_data = {
                'id': row.get('id'),
                'rating': row.get('rating'),
                'text': row.get('review_text', ''),
                'created_at': row.get('created_at'),
                'reviewer': {
                    'id': row.get('reviewer_id'),
                    'name': reviewer_name,
                    'avatar': avatar_url
                }
            }
            
            reviews.append(review_data)
            logger.info(f"  ✅ Review {row.get('id')}: {reviewer_name} - {row.get('rating')}⭐")
        
        response_data = {
            'reviews': reviews,
            'count': len(reviews)
        }
        
        logger.info(f"✅ Returning {len(reviews)} reviews")
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"❌ Error getting blogger reviews: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500






@app.route('/bot/set_fsm_state', methods=['POST'])
def set_bot_fsm_state():
    """Internal endpoint to set FSM state for bot (called from premium post flow)"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        state = data.get('state')
        state_data = data.get('data', {})
        
        if not user_id or not state:
            return jsonify({'error': 'user_id and state are required'}), 400
        

        conn = get_db()
        cursor = conn.cursor()
        
      
        cursor.execute("""
            INSERT OR REPLACE INTO bot_fsm_states (user_id, state, data, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        """, (user_id, state, json.dumps(state_data)))
        
        conn.commit()
        conn.close()
        
        logger.info(f"✅ FSM state set for user {user_id}: {state}")
        
        return jsonify({'success': True})
        
    except Exception as e:
        logger.error(f"❌ Error setting FSM state: {e}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500







if __name__ == '__main__':
    logger.info("=" * 60)
    logger.info("ЗАПУСК................")
    logger.info(f"ТОКЕН: {'✅' if BOT_TOKEN else '❌'}")
    if BOT_TOKEN:
        logger.info(f" {BOT_TOKEN[:20]}...")
        logger.info(f"ТОКЕН НА СЕРВЕРЕ: {'TELEGRAM_BOT_TOKEN' if os.environ.get('TELEGRAM_BOT_TOKEN') else 'default value'}")
    logger.info("=" * 60)
    app.run(debug=False, host='0.0.0.0', port=7777)

