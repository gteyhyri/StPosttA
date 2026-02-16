

import sqlite3

CREATE_USERS_TABLE = """
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT DEFAULT '',
    username TEXT DEFAULT '',
    photo_url TEXT DEFAULT '',
    language_code TEXT DEFAULT 'ru',
    is_premium INTEGER DEFAULT 0,
    user_type TEXT DEFAULT 'user',
    balance REAL DEFAULT 0.0,
    total_orders INTEGER DEFAULT 0,
    total_spent REAL DEFAULT 0.0,
    blogger_photo_url TEXT DEFAULT '',
    blogger_price TEXT DEFAULT '',
    blogger_subscribers TEXT DEFAULT '',
    blogger_is_active INTEGER DEFAULT 0,
    referrer_id INTEGER,
    referral_commission_generated REAL DEFAULT 0.0,
    referral_commission_received REAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

CREATE_ORDERS_TABLE = """
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    order_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (user_id)
);
"""

CREATE_ADVERTISEMENTS_TABLE = """
CREATE TABLE IF NOT EXISTS advertisements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    target_url TEXT,
    budget REAL NOT NULL,
    spent REAL DEFAULT 0.0,
    status TEXT DEFAULT 'active',
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (user_id)
);

"""

CREATE_BLOGGER_SCHEDULE_TABLE = """
CREATE TABLE IF NOT EXISTS blogger_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    weekday_short TEXT NOT NULL,
    from_time TEXT NOT NULL,
    to_time TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (user_id)
);

"""

CREATE_BLOGGER_APPLICATIONS_TABLE = """
CREATE TABLE IF NOT EXISTS blogger_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    channel_link TEXT NOT NULL,
    channel_id TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    verified INTEGER DEFAULT 0,
    submitted_for_review INTEGER DEFAULT 0,
    rejection_reason TEXT DEFAULT '',
    topic_group_key TEXT DEFAULT '',
    topic_group_title TEXT DEFAULT '',
    topic_sub_key TEXT DEFAULT '',
    topic_sub_title TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (user_id)
);

"""

CREATE_CHAT_MESSAGES_TABLE = """
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    message_type TEXT DEFAULT 'text',
    metadata TEXT DEFAULT '',
    is_read INTEGER DEFAULT 0,
    channel_id INTEGER DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users (user_id),
    FOREIGN KEY (receiver_id) REFERENCES users (user_id)
);






"""

CREATE_AD_POSTS_TABLE = """
CREATE TABLE IF NOT EXISTS ad_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER NOT NULL,
    blogger_id INTEGER NOT NULL,
    channel_id INTEGER DEFAULT NULL,
    post_text TEXT NOT NULL,
    post_images TEXT DEFAULT '',
    telegram_message_ids TEXT DEFAULT '',
    scheduled_time TIMESTAMP NOT NULL,
    delete_time TIMESTAMP NOT NULL,
    price REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created_from_offer INTEGER DEFAULT 0,
    posted_at TIMESTAMP,
    deleted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (buyer_id) REFERENCES users (user_id),
    FOREIGN KEY (blogger_id) REFERENCES users (user_id),
    FOREIGN KEY (channel_id) REFERENCES blogger_channels (id)
);










"""

CREATE_OFFERS_TABLE = """
CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    images TEXT DEFAULT '',
    hour_price REAL NOT NULL,
    topic TEXT DEFAULT '',
    duration_hours INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (user_id)
);



"""

CREATE_OFFER_PUBLICATIONS_TABLE = """
CREATE TABLE IF NOT EXISTS offer_publications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id INTEGER NOT NULL,
    blogger_id INTEGER NOT NULL,
    scheduled_time TIMESTAMP NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (offer_id) REFERENCES offers (id),
    FOREIGN KEY (blogger_id) REFERENCES users (user_id)
);

"""



CREATE_REVIEWS_TABLE = """
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    reviewer_id INTEGER NOT NULL,
    reviewed_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    review_text TEXT,
    review_type TEXT NOT NULL CHECK(review_type IN ('blogger', 'buyer')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, reviewer_id, review_type),
    FOREIGN KEY (reviewer_id) REFERENCES users (user_id),
    FOREIGN KEY (reviewed_id) REFERENCES users (user_id)
);
"""

class User:

    
    @staticmethod
    def create_or_update(cursor, user_data, referrer_id=None):
    
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
    
    @staticmethod
    def get_by_id(cursor, user_id):
   
        cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        if row:
            return dict(row)
        return None
    


    @staticmethod
    def update_balance(cursor, user_id, amount, operation='add'):



        if operation == 'add':
            cursor.execute("""
                UPDATE users 
                SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
            """, (amount, user_id))
        elif operation == 'subtract':
            cursor.execute("""
                UPDATE users 
                SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
            """, (amount, user_id))
        elif operation == 'set':
            cursor.execute("""
                UPDATE users 
                SET balance = ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
            """, (amount, user_id))
    
    @staticmethod
    def update_stats(cursor, user_id, total_orders=None, total_spent=None):
       
        if total_orders is not None:
            cursor.execute("""
                UPDATE users 
                SET total_orders = total_orders + ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
            """, (total_orders, user_id))
        
        if total_spent is not None:
            cursor.execute("""
                UPDATE users 
                SET total_spent = total_spent + ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
            """, (total_spent, user_id))
    

    @staticmethod
    def update_user_type(cursor, user_id, user_type):
      
        cursor.execute("""
            UPDATE users 
            SET user_type = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        """, (user_type, user_id))










class Order:

    
    @staticmethod
    def create(cursor, user_id, order_type, title, description, amount):
   
        cursor.execute("""
            INSERT INTO orders (user_id, order_type, title, description, amount, status)
            VALUES (?, ?, ?, ?, ?, 'completed')
        """, (user_id, order_type, title, description, amount))
        return cursor.lastrowid
    
    @staticmethod
    def get_user_orders(cursor, user_id, limit=10):
    
        cursor.execute("""
            SELECT * FROM orders 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ?
        """, (user_id, limit))
        return [dict(row) for row in cursor.fetchall()]
    
    @staticmethod
    def get_order_count(cursor, user_id):

        cursor.execute("""
            SELECT COUNT(*) as count FROM orders WHERE user_id = ?
        """, (user_id,))
        return cursor.fetchone()['count']
    
    @staticmethod
    def get_total_spent(cursor, user_id):
        
        cursor.execute("""
            SELECT COALESCE(SUM(amount), 0) as total FROM orders WHERE user_id = ?
        """, (user_id,))
        return cursor.fetchone()['total']


class Advertisement:
   
    
    @staticmethod
    def create(cursor, user_id, title, description, target_url, budget):

        cursor.execute("""
            INSERT INTO advertisements (user_id, title, description, target_url, budget, status)
            VALUES (?, ?, ?, ?, ?, 'active')
        """, (user_id, title, description, target_url, budget))
        return cursor.lastrowid
    


    @staticmethod
    def get_active_ads(cursor, user_id):
    
        cursor.execute("""
            SELECT * FROM advertisements 
            WHERE user_id = ? AND status = 'active'
            ORDER BY created_at DESC
        """, (user_id,))
        return [dict(row) for row in cursor.fetchall()]
    


    @staticmethod
    def get_active_count(cursor, user_id):
       
        cursor.execute("""
            SELECT COUNT(*) as count FROM advertisements 
            WHERE user_id = ? AND status = 'active'
        """, (user_id,))
        return cursor.fetchone()['count']
    
    @staticmethod
    def update_stats(cursor, ad_id, impressions=None, clicks=None):
  
        if impressions is not None:
            cursor.execute("""
                UPDATE advertisements 
                SET impressions = impressions + ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (impressions, ad_id))
        
        if clicks is not None:
            cursor.execute("""
                UPDATE advertisements 
                SET clicks = clicks + ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (clicks, ad_id))
    
    @staticmethod
    def deactivate(cursor, ad_id):
  
        cursor.execute("""
            UPDATE advertisements 
            SET status = 'completed', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (ad_id,))


class BloggerApplication:
    
    
    @staticmethod
    def create(cursor, user_id, channel_link):
      
        cursor.execute("""
            INSERT INTO blogger_applications (user_id, channel_link, status)
            VALUES (?, ?, 'pending')
        """, (user_id, channel_link))
        return cursor.lastrowid
    
    @staticmethod
    def get_by_user(cursor, user_id):

        cursor.execute("""
            SELECT * FROM blogger_applications 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        """, (user_id,))
        row = cursor.fetchone()
        if row:
            return dict(row)
        return None
    



    @staticmethod
    def update_status(cursor, application_id, status, verified=None):

        if verified is not None:
            cursor.execute("""
                UPDATE blogger_applications 
                SET status = ?, verified = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (status, 1 if verified else 0, application_id))
        else:
            cursor.execute("""
                UPDATE blogger_applications 
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (status, application_id))
    
    @staticmethod
    def update_channel_id(cursor, application_id, channel_id):

        cursor.execute("""
            UPDATE blogger_applications 
            SET channel_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (channel_id, application_id))
    
    @staticmethod
    def set_rejection_reason(cursor, application_id, reason):
  
        cursor.execute("""
            UPDATE blogger_applications 
            SET rejection_reason = ?, status = 'rejected', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (reason, application_id))
    
    @staticmethod
    def get_by_id(cursor, application_id):
  
        cursor.execute("""
            SELECT * FROM blogger_applications 
            WHERE id = ?
        """, (application_id,))
        row = cursor.fetchone()
        if row:
            return dict(row)
        return None


class ChatMessage:
  
    
    @staticmethod
    def create(cursor, sender_id, receiver_id, message, channel_id=None):
       
        cursor.execute("""
            INSERT INTO chat_messages (sender_id, receiver_id, message, channel_id)
            VALUES (?, ?, ?, ?)
        """, (sender_id, receiver_id, message, channel_id))
        return cursor.lastrowid
    
    @staticmethod
    def get_conversation(cursor, user1_id, user2_id, channel_id=None, limit=50):
  
        if channel_id is not None:
       
            cursor.execute("""
                SELECT cm.*, 
                       u1.first_name as sender_first_name, 
                       u1.last_name as sender_last_name,
                       u1.username as sender_username,
                       u2.first_name as receiver_first_name,
                       u2.last_name as receiver_last_name,
                       u2.username as receiver_username
                FROM chat_messages cm
                LEFT JOIN users u1 ON cm.sender_id = u1.user_id
                LEFT JOIN users u2 ON cm.receiver_id = u2.user_id
                WHERE ((cm.sender_id = ? AND cm.receiver_id = ?) 
                   OR (cm.sender_id = ? AND cm.receiver_id = ?))
                   AND cm.channel_id = ?
                ORDER BY cm.created_at DESC
                LIMIT ?
            """, (user1_id, user2_id, user2_id, user1_id, channel_id, limit))
        else:
          

            cursor.execute("""
                SELECT cm.*, 
                       u1.first_name as sender_first_name, 
                       u1.last_name as sender_last_name,
                       u1.username as sender_username,
                       u2.first_name as receiver_first_name,
                       u2.last_name as receiver_last_name,
                       u2.username as receiver_username
                FROM chat_messages cm
                LEFT JOIN users u1 ON cm.sender_id = u1.user_id
                LEFT JOIN users u2 ON cm.receiver_id = u2.user_id
                WHERE ((cm.sender_id = ? AND cm.receiver_id = ?) 
                   OR (cm.sender_id = ? AND cm.receiver_id = ?))
                   AND cm.channel_id IS NULL
                ORDER BY cm.created_at DESC
                LIMIT ?
            """, (user1_id, user2_id, user2_id, user1_id, limit))
        
    
        rows = cursor.fetchall()
        return [dict(row) for row in reversed(rows)]
    



    @staticmethod
    def mark_as_read(cursor, sender_id, receiver_id, channel_id=None):
      

        if channel_id is not None:
            cursor.execute("""
                UPDATE chat_messages 
                SET is_read = 1
                WHERE sender_id = ? AND receiver_id = ? AND channel_id = ? AND is_read = 0
            """, (sender_id, receiver_id, channel_id))
        else:
           
            cursor.execute("""
                UPDATE chat_messages 
                SET is_read = 1
                WHERE sender_id = ? AND receiver_id = ? AND channel_id IS NULL AND is_read = 0
            """, (sender_id, receiver_id))
    
    @staticmethod
    def get_unread_count(cursor, user_id):
 
        cursor.execute("""
            SELECT COUNT(*) as count 
            FROM chat_messages 
            WHERE receiver_id = ? AND is_read = 0
        """, (user_id,))
        return cursor.fetchone()['count']


class AdPost:

    
    @staticmethod
    def create(cursor, buyer_id, blogger_id, post_text, post_images, scheduled_time, delete_time, price, created_from_offer=0, channel_id=None, is_premium_post=0, premium_message_id=None, premium_chat_id=None):
    
        try:
            cursor.execute("""
                INSERT INTO ad_posts (buyer_id, blogger_id, channel_id, post_text, post_images, scheduled_time, delete_time, price, status, created_from_offer, is_premium_post, premium_message_id, premium_chat_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
            """, (buyer_id, blogger_id, channel_id, post_text, post_images, scheduled_time, delete_time, price, int(bool(created_from_offer)), int(bool(is_premium_post)), premium_message_id, premium_chat_id))
        except sqlite3.OperationalError as e:
          


            if "no column named created_from_offer" in str(e):
                cursor.execute("""
                    ALTER TABLE ad_posts
                    ADD COLUMN created_from_offer INTEGER DEFAULT 0
                """)
                cursor.execute("""
                    INSERT INTO ad_posts (buyer_id, blogger_id, channel_id, post_text, post_images, scheduled_time, delete_time, price, status, created_from_offer, is_premium_post, premium_message_id, premium_chat_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
                """, (buyer_id, blogger_id, channel_id, post_text, post_images, scheduled_time, delete_time, price, int(bool(created_from_offer)), int(bool(is_premium_post)), premium_message_id, premium_chat_id))
            elif "no column named channel_id" in str(e):
                cursor.execute("""
                    ALTER TABLE ad_posts
                    ADD COLUMN channel_id INTEGER DEFAULT NULL
                """)
                cursor.execute("""
                    INSERT INTO ad_posts (buyer_id, blogger_id, channel_id, post_text, post_images, scheduled_time, delete_time, price, status, created_from_offer, is_premium_post, premium_message_id, premium_chat_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
                """, (buyer_id, blogger_id, channel_id, post_text, post_images, scheduled_time, delete_time, price, int(bool(created_from_offer)), int(bool(is_premium_post)), premium_message_id, premium_chat_id))
            elif "no column named is_premium_post" in str(e) or "no column named premium_message_id" in str(e) or "no column named premium_chat_id" in str(e):
             
                try:
                    cursor.execute("ALTER TABLE ad_posts ADD COLUMN is_premium_post INTEGER DEFAULT 0")
                except sqlite3.OperationalError:
                    pass
                try:



            
                    cursor.execute("ALTER TABLE ad_posts ADD COLUMN premium_message_id INTEGER DEFAULT NULL")
                except sqlite3.OperationalError:






                    pass
                try:

                    cursor.execute("ALTER TABLE ad_posts ADD COLUMN premium_chat_id INTEGER DEFAULT NULL")
                except sqlite3.OperationalError:
                    pass

                cursor.execute("""
                    INSERT INTO ad_posts (buyer_id, blogger_id, channel_id, post_text, post_images, scheduled_time, delete_time, price, status, created_from_offer, is_premium_post, premium_message_id, premium_chat_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
                """, (buyer_id, blogger_id, channel_id, post_text, post_images, scheduled_time, delete_time, price, int(bool(created_from_offer)), int(bool(is_premium_post)), premium_message_id, premium_chat_id))
            else:
                raise
        return cursor.lastrowid
    
    @staticmethod
    def get_by_id(cursor, post_id):
   
        cursor.execute("""
            SELECT ap.*, 
                   u1.first_name as buyer_first_name,
                   u1.last_name as buyer_last_name,
                   u1.username as buyer_username,
                   u2.first_name as blogger_first_name,
                   u2.last_name as blogger_last_name,
                   u2.username as blogger_username
            FROM ad_posts ap
            LEFT JOIN users u1 ON ap.buyer_id = u1.user_id
            LEFT JOIN users u2 ON ap.blogger_id = u2.user_id
            WHERE ap.id = ?
        """, (post_id,))
        row = cursor.fetchone()
        if row:
            return dict(row)
        return None
    


    @staticmethod
    def update_status(cursor, post_id, status):
       
        cursor.execute("""
            UPDATE ad_posts 
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (status, post_id))
    


    @staticmethod
    def get_pending_posts_for_blogger(cursor, blogger_id):
       
        cursor.execute("""
            SELECT ap.*,
                   u.first_name as buyer_first_name,
                   u.last_name as buyer_last_name,
                   u.username as buyer_username,
                   bc.channel_name,
                   bc.channel_link
            FROM ad_posts ap
            LEFT JOIN users u ON ap.buyer_id = u.user_id
            LEFT JOIN blogger_channels bc ON ap.channel_id = bc.id
            WHERE ap.blogger_id = ? AND ap.status = 'pending'
            ORDER BY ap.created_at DESC
        """, (blogger_id,))
        return [dict(row) for row in cursor.fetchall()]


class Offer:
    
    

    @staticmethod
    def create(cursor, user_id, text, images_json, hour_price, topic, duration_hours):
        cursor.execute("""
            INSERT INTO offers (user_id, text, images, hour_price, topic, duration_hours)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (user_id, text, images_json, hour_price, topic, duration_hours))
        return cursor.lastrowid
    


    @staticmethod
    def get_by_id(cursor, offer_id):
        cursor.execute("""
            SELECT * FROM offers
            WHERE id = ?
        """, (offer_id,))
        row = cursor.fetchone()
        if row:
            return dict(row)
        return None
    


    @staticmethod
    def get_user_offers(cursor, user_id, limit=50):
        cursor.execute("""
            SELECT * FROM offers
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        """, (user_id, limit))
        return [dict(row) for row in cursor.fetchall()]

    @staticmethod
    def get_all_offers(cursor, limit=50):
       
        cursor.execute("""
            SELECT * FROM offers
            ORDER BY created_at DESC
            LIMIT ?
        """, (limit,))
        return [dict(row) for row in cursor.fetchall()]


class OfferPublication:
    
    
    @staticmethod
    def create(cursor, offer_id, blogger_id, scheduled_time):
      
        try:
            cursor.execute("""
                INSERT INTO offer_publications (offer_id, blogger_id, scheduled_time, status)
                VALUES (?, ?, ?, 'active')
            """, (offer_id, blogger_id, scheduled_time))
        except sqlite3.OperationalError as e:
       
            if "no column named status" in str(e):
                cursor.execute("""
                    ALTER TABLE offer_publications
                    ADD COLUMN status TEXT DEFAULT 'active'
                """)
                cursor.execute("""
                    INSERT INTO offer_publications (offer_id, blogger_id, scheduled_time, status)
                    VALUES (?, ?, ?, 'active')
                """, (offer_id, blogger_id, scheduled_time))
            else:
                raise
        return cursor.lastrowid




    @staticmethod
    def get_by_id(cursor, proposal_id):
       
        cursor.execute("""
            SELECT * FROM offer_publications
            WHERE id = ?
        """, (proposal_id,))
        row = cursor.fetchone()
        if row:
            return dict(row)
        return None



    @staticmethod
    def delete(cursor, proposal_id):
       


        cursor.execute("""
            DELETE FROM offer_publications
            WHERE id = ?
        """, (proposal_id,))




    @staticmethod
    def update_status(cursor, proposal_id, status):
  
        try:
            cursor.execute("""
                UPDATE offer_publications
                SET status = ?
                WHERE id = ?
            """, (status, proposal_id))
        except sqlite3.OperationalError as e:
            if "no column named status" in str(e):
                cursor.execute("""
                    ALTER TABLE offer_publications
                    ADD COLUMN status TEXT DEFAULT 'active'
                """)
                cursor.execute("""
                    UPDATE offer_publications
                    SET status = ?
                    WHERE id = ?
                """, (status, proposal_id))
            else:
                raise




    @staticmethod
    def list_for_chat(cursor, user_id, partner_id):
     
        cursor.execute("""
            SELECT 
                op.*,
                o.text,
                o.images,
                o.hour_price,
                o.duration_hours,
                o.user_id AS buyer_id
            FROM offer_publications op
            JOIN offers o ON op.offer_id = o.id
            WHERE (
                    (o.user_id = ? AND op.blogger_id = ?)
                 OR (o.user_id = ? AND op.blogger_id = ?)
                  )
            ORDER BY op.created_at ASC
        """, (user_id, partner_id, partner_id, user_id))
        rows = cursor.fetchall() or []
        return [dict(row) for row in rows]


