
import sqlite3
import os
import logging
from flask import g
from .models import (
    CREATE_USERS_TABLE,
    CREATE_ORDERS_TABLE,
    CREATE_ADVERTISEMENTS_TABLE,
    CREATE_BLOGGER_APPLICATIONS_TABLE,
    CREATE_BLOGGER_SCHEDULE_TABLE,
    CREATE_CHAT_MESSAGES_TABLE,
    CREATE_AD_POSTS_TABLE,
    CREATE_OFFERS_TABLE,
    CREATE_OFFER_PUBLICATIONS_TABLE,
    CREATE_REVIEWS_TABLE,
)

logger = logging.getLogger(__name__)


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_PATH = os.path.join(BASE_DIR, 'users.db')

def dict_factory(cursor, row):

    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

def get_db():
   
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE_PATH)
        g.db.row_factory = dict_factory
    return g.db

def close_db(e=None):
   
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db():
 
  
    db_exists = os.path.exists(DATABASE_PATH)
    
    logger.info("=" * 60)
    logger.info("🗃️  INITIALIZING DATABASE")
    logger.info(f"📂 Project directory: {BASE_DIR}")
    logger.info(f"📁 Working directory: {os.getcwd()}")
    logger.info(f"🗃️  Database path: {DATABASE_PATH}")
    logger.info(f"📊 Database exists before init: {db_exists}")
    
    try:

        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = dict_factory
        cursor = conn.cursor()
        
   
        logger.info("📝 Creating tables...")
        cursor.execute(CREATE_USERS_TABLE)
        logger.info("  ✅ users table created/verified")
        cursor.execute(CREATE_ORDERS_TABLE)
        logger.info("  ✅ orders table created/verified")
        cursor.execute(CREATE_ADVERTISEMENTS_TABLE)
        logger.info("  ✅ advertisements table created/verified")
        cursor.execute(CREATE_BLOGGER_APPLICATIONS_TABLE)
        logger.info("  ✅ blogger_applications table created/verified")
        cursor.execute(CREATE_BLOGGER_SCHEDULE_TABLE)
        logger.info("  ✅ blogger_schedules table created/verified")
        cursor.execute(CREATE_CHAT_MESSAGES_TABLE)
        logger.info("  ✅ chat_messages table created/verified")
        cursor.execute(CREATE_AD_POSTS_TABLE)
        logger.info("  ✅ ad_posts table created/verified")
        cursor.execute(CREATE_OFFERS_TABLE)
        logger.info("  ✅ offers table created/verified")
        cursor.execute(CREATE_OFFER_PUBLICATIONS_TABLE)
        logger.info("  ✅ offer_publications table created/verified")
        cursor.execute(CREATE_REVIEWS_TABLE)
        logger.info("  ✅ reviews table created/verified")
        
        
        from .escrow_model import EscrowTransaction
        EscrowTransaction.create_table(cursor)
        logger.info("  ✅ escrow_transactions table created/verified")
        
 
        from .withdrawal_model import WithdrawalModel
        WithdrawalModel.create_table(cursor)
        logger.info("  ✅ withdrawal_requests table created/verified")
        
       
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS blogger_channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                channel_link TEXT NOT NULL,
                channel_id TEXT DEFAULT '',
                channel_name TEXT DEFAULT '',
                channel_photo_url TEXT DEFAULT '',
                subscribers_count TEXT DEFAULT '0',
                price TEXT DEFAULT '',
                price_permanent TEXT DEFAULT '',
                topic_group_key TEXT DEFAULT '',
                topic_group_title TEXT DEFAULT '',
                topic_sub_key TEXT DEFAULT '',
                topic_sub_title TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                is_verified INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (user_id)
            )
        """)
        logger.info("  ✅ blogger_channels table created/verified")
  
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS channel_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id INTEGER NOT NULL,
                weekday_short TEXT NOT NULL,
                from_time TEXT NOT NULL,
                to_time TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (channel_id) REFERENCES blogger_channels (id) ON DELETE CASCADE
            )
        """)
        logger.info("  ✅ channel_schedules table created/verified")
        
       
        if db_exists:
            logger.info("📝 Checking and adding missing columns...")
            
    
            cursor.execute("PRAGMA table_info(users)")
            users_columns = [col['name'] for col in cursor.fetchall()]
            
            if 'user_type' not in users_columns:
                cursor.execute("ALTER TABLE users ADD COLUMN user_type TEXT DEFAULT 'user'")
                logger.info("  ✅ Added column user_type to users")
            
            if 'blogger_photo_url' not in users_columns:
                cursor.execute("ALTER TABLE users ADD COLUMN blogger_photo_url TEXT DEFAULT ''")
                logger.info("  ✅ Added column blogger_photo_url to users")
            
            if 'blogger_price' not in users_columns:
                cursor.execute("ALTER TABLE users ADD COLUMN blogger_price TEXT DEFAULT ''")
                logger.info("  ✅ Added column blogger_price to users")
            
            if 'blogger_price_permanent' not in users_columns:
                cursor.execute("ALTER TABLE users ADD COLUMN blogger_price_permanent TEXT DEFAULT ''")
                logger.info("  ✅ Added column blogger_price_permanent to users")
            
            if 'blogger_subscribers' not in users_columns:
                cursor.execute("ALTER TABLE users ADD COLUMN blogger_subscribers TEXT DEFAULT ''")
                logger.info("  ✅ Added column blogger_subscribers to users")

            if 'blogger_is_active' not in users_columns:
                cursor.execute("ALTER TABLE users ADD COLUMN blogger_is_active INTEGER DEFAULT 0")
                logger.info("  ✅ Added column blogger_is_active to users")

            if 'referrer_id' not in users_columns:
                cursor.execute("ALTER TABLE users ADD COLUMN referrer_id INTEGER")
                logger.info("  ✅ Added column referrer_id to users")

            if 'referral_commission_generated' not in users_columns:
                cursor.execute("ALTER TABLE users ADD COLUMN referral_commission_generated REAL DEFAULT 0.0")
                logger.info("  ✅ Added column referral_commission_generated to users")

            if 'referral_commission_received' not in users_columns:
                cursor.execute("ALTER TABLE users ADD COLUMN referral_commission_received REAL DEFAULT 0.0")
                logger.info("  ✅ Added column referral_commission_received to users")
            
          
            cursor.execute("PRAGMA table_info(blogger_applications)")
            app_columns = [col['name'] for col in cursor.fetchall()]
            
            if 'channel_id' not in app_columns:
                cursor.execute("ALTER TABLE blogger_applications ADD COLUMN channel_id TEXT DEFAULT ''")
                logger.info("  ✅ Added column channel_id to blogger_applications")
            
            if 'rejection_reason' not in app_columns:
                cursor.execute("ALTER TABLE blogger_applications ADD COLUMN rejection_reason TEXT DEFAULT ''")
                logger.info("  ✅ Added column rejection_reason to blogger_applications")
            
            if 'submitted_for_review' not in app_columns:
                cursor.execute("ALTER TABLE blogger_applications ADD COLUMN submitted_for_review INTEGER DEFAULT 0")
                logger.info("  ✅ Added column submitted_for_review to blogger_applications")
            
            if 'channel_photo_url' not in app_columns:
                cursor.execute("ALTER TABLE blogger_applications ADD COLUMN channel_photo_url TEXT DEFAULT ''")
                logger.info("  ✅ Added column channel_photo_url to blogger_applications")
            
          
            cursor.execute("PRAGMA table_info(blogger_channels)")
            channels_columns = [col['name'] for col in cursor.fetchall()]
            
            if 'price_permanent' not in channels_columns:
                cursor.execute("ALTER TABLE blogger_channels ADD COLUMN price_permanent TEXT DEFAULT ''")
                logger.info("  ✅ Added column price_permanent to blogger_channels")
      
            cursor.execute("""
                UPDATE blogger_applications
                SET channel_photo_url = (
                    SELECT blogger_photo_url 
                    FROM users 
                    WHERE users.user_id = blogger_applications.user_id
                )
                WHERE (channel_photo_url IS NULL OR channel_photo_url = '')
                AND status = 'approved'
                AND EXISTS (
                    SELECT 1 FROM users 
                    WHERE users.user_id = blogger_applications.user_id 
                    AND users.blogger_photo_url IS NOT NULL 
                    AND users.blogger_photo_url != ''
                )
            """)
            updated_count = cursor.rowcount
            if updated_count > 0:
                logger.info(f"  ✅ Copied blogger_photo_url to channel_photo_url for {updated_count} applications")

            if 'topic_group_key' not in app_columns:
                cursor.execute("ALTER TABLE blogger_applications ADD COLUMN topic_group_key TEXT DEFAULT ''")
                logger.info("  ✅ Added column topic_group_key to blogger_applications")

            if 'topic_group_title' not in app_columns:
                cursor.execute("ALTER TABLE blogger_applications ADD COLUMN topic_group_title TEXT DEFAULT ''")
                logger.info("  ✅ Added column topic_group_title to blogger_applications")

            if 'topic_sub_key' not in app_columns:
                cursor.execute("ALTER TABLE blogger_applications ADD COLUMN topic_sub_key TEXT DEFAULT ''")
                logger.info("  ✅ Added column topic_sub_key to blogger_applications")

            if 'topic_sub_title' not in app_columns:
                cursor.execute("ALTER TABLE blogger_applications ADD COLUMN topic_sub_title TEXT DEFAULT ''")
                logger.info("  ✅ Added column topic_sub_title to blogger_applications")

   
            cursor.execute("PRAGMA table_info(ad_posts)")
            ad_posts_columns = [col['name'] for col in cursor.fetchall()]

            if 'telegram_message_ids' not in ad_posts_columns:
                cursor.execute("ALTER TABLE ad_posts ADD COLUMN telegram_message_ids TEXT DEFAULT ''")
                logger.info("  ✅ Added column telegram_message_ids to ad_posts")

            if 'posted_at' not in ad_posts_columns:
                cursor.execute("ALTER TABLE ad_posts ADD COLUMN posted_at TIMESTAMP")
                logger.info("  ✅ Added column posted_at to ad_posts")

            if 'deleted_at' not in ad_posts_columns:
                cursor.execute("ALTER TABLE ad_posts ADD COLUMN deleted_at TIMESTAMP")
                logger.info("  ✅ Added column deleted_at to ad_posts")
        
      
            cursor.execute("PRAGMA table_info(chat_messages)")
            chat_messages_columns = [col['name'] for col in cursor.fetchall()]
            
            if 'message_type' not in chat_messages_columns:
                cursor.execute("ALTER TABLE chat_messages ADD COLUMN message_type TEXT DEFAULT 'text'")
                logger.info("  ✅ Added column message_type to chat_messages")
            
            if 'metadata' not in chat_messages_columns:
                cursor.execute("ALTER TABLE chat_messages ADD COLUMN metadata TEXT DEFAULT ''")
                logger.info("  ✅ Added column metadata to chat_messages")
            
         
            cursor.execute("PRAGMA table_info(reviews)")
            reviews_columns = [col['name'] for col in cursor.fetchall()]
            
            if 'review_text' not in reviews_columns:
                cursor.execute("ALTER TABLE reviews ADD COLUMN review_text TEXT")
                logger.info("  ✅ Added column review_text to reviews")
        
     
        logger.info("📝 Creating indexes for reviews table...")
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_id 
            ON reviews(reviewed_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id 
            ON reviews(reviewer_id)
        """)
        logger.info("  ✅ Reviews indexes created/verified")
        
    
        logger.info("📝 Fixing empty subscribers_count in blogger_channels...")
        cursor.execute("""
            UPDATE blogger_channels 
            SET subscribers_count = '0' 
            WHERE subscribers_count = '' OR subscribers_count IS NULL
        """)
        rows_updated = cursor.rowcount
        if rows_updated > 0:
            logger.info(f"  ✅ Fixed {rows_updated} channels with empty subscribers_count")
        else:
            logger.info("  ✅ No channels needed fixing")
        

        conn.commit()
        conn.close()
        
        if not db_exists:
            logger.info(f"✅ Database CREATED: {DATABASE_PATH}")
        else:
            logger.info(f"✅ Database UPDATED: {DATABASE_PATH}")
        
        
        if os.path.exists(DATABASE_PATH):
            file_size = os.path.getsize(DATABASE_PATH)
            logger.info(f"✅ Database file verified ({file_size} bytes)")
        else:
            logger.error(f"❌ Database file NOT found after creation!")
            
        logger.info("=" * 60)
        return True
        
    except Exception as e:
        logger.error(f"❌ Error initializing database: {e}", exc_info=True)
        logger.info("=" * 60)
        return False

def get_user_profile_data(user_id):
    """Get complete user profile data"""
    db = get_db()
    cursor = db.cursor()
    

    cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
    user = cursor.fetchone()
    
    if not user:
        return None
    
   
    cursor.execute("""
        SELECT COUNT(*) as total_orders, COALESCE(SUM(amount), 0) as total_spent
        FROM orders WHERE user_id = ?
    """, (user_id,))
    order_stats = cursor.fetchone()
    

    cursor.execute("""
        SELECT COUNT(*) as active_ads
        FROM advertisements WHERE user_id = ? AND status = 'active'
    """, (user_id,))
    ad_stats = cursor.fetchone()
    
    profile = {
        **user,
        'total_orders': order_stats['total_orders'],
        'total_spent': order_stats['total_spent'],
        'active_ads': ad_stats['active_ads']
    }
    
    return profile

def get_user_order_history(user_id, limit=10):
    
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute("""
        SELECT 
            ap.id,
            ap.post_text,
            ap.price,
            ap.status,
            ap.scheduled_time,
            ap.delete_time,
            ap.posted_at,
            ap.deleted_at,
            ap.created_at,
            bc.channel_name,
            bc.channel_link,
            bc.channel_photo_url,
            u.first_name as blogger_first_name,
            u.last_name as blogger_last_name,
            u.username as blogger_username
        FROM ad_posts ap
        LEFT JOIN blogger_channels bc ON ap.channel_id = bc.id
        LEFT JOIN users u ON ap.blogger_id = u.user_id
        WHERE ap.buyer_id = ?
        ORDER BY ap.created_at DESC
        LIMIT ?
    """, (user_id, limit))
    
    rows = cursor.fetchall()
    return [dict(row) for row in rows]

def get_user_active_ads(user_id):
    db = get_db()
    cursor = db.cursor()
    
    cursor.execute("""
        SELECT 
            ap.id,
            ap.post_text,
            ap.price,
            ap.status,
            ap.scheduled_time,
            ap.delete_time,
            ap.posted_at,
            ap.created_at,
            bc.channel_name,
            bc.channel_link,
            bc.channel_photo_url,
            u.first_name as blogger_first_name,
            u.last_name as blogger_last_name,
            u.username as blogger_username
        FROM ad_posts ap
        LEFT JOIN blogger_channels bc ON ap.channel_id = bc.id
        LEFT JOIN users u ON ap.blogger_id = u.user_id
        WHERE ap.buyer_id = ? 
        AND ap.status IN ('pending', 'approved', 'posted')
        AND ap.deleted_at IS NULL
        ORDER BY ap.created_at DESC
    """, (user_id,))
    
    rows = cursor.fetchall()
    return [dict(row) for row in rows]

def create_or_update_user(user_data, referrer_id=None):
  
    db = get_db()
    cursor = db.cursor()

 
    cursor.execute("SELECT 1 FROM users WHERE user_id = ?", (user_data.get('id'),))
    exists = cursor.fetchone() is not None

    if exists or not referrer_id:
        cursor.execute("""
            INSERT INTO users (user_id, first_name, last_name, username, photo_url, language_code, is_premium)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                first_name = excluded.first_name,
                last_name = excluded.last_name,
                username = excluded.username,
                photo_url = excluded.photo_url,
                language_code = excluded.language_code,
                is_premium = excluded.is_premium,
                updated_at = CURRENT_TIMESTAMP
        """, (
            user_data.get('id'),
            user_data.get('first_name', ''),
            user_data.get('last_name', ''),
            user_data.get('username', ''),
            user_data.get('photo_url', ''),
            user_data.get('language_code', 'ru'),
            1 if user_data.get('is_premium', False) else 0
        ))
    else:
        cursor.execute("""
            INSERT INTO users (
                user_id, first_name, last_name, username, photo_url,
                language_code, is_premium, referrer_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_data.get('id'),
            user_data.get('first_name', ''),
            user_data.get('last_name', ''),
            user_data.get('username', ''),
            user_data.get('photo_url', ''),
            user_data.get('language_code', 'ru'),
            1 if user_data.get('is_premium', False) else 0,
            referrer_id
        ))
    
    db.commit()
    return cursor.lastrowid

