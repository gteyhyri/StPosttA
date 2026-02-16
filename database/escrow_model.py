
import logging
from datetime import datetime
logger = logging.getLogger(__name__)


class EscrowTransaction:

    
    @staticmethod
    def create_table(cursor):
    
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS escrow_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ad_post_id INTEGER NOT NULL UNIQUE,
                buyer_id INTEGER NOT NULL,
                blogger_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                commission_rate REAL DEFAULT 0.10,
                status TEXT DEFAULT 'held',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                released_at TIMESTAMP,
                FOREIGN KEY (ad_post_id) REFERENCES ad_posts (id),
                FOREIGN KEY (buyer_id) REFERENCES users (user_id),
                FOREIGN KEY (blogger_id) REFERENCES users (user_id)
            )
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_escrow_ad_post_id 
            ON escrow_transactions(ad_post_id)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_escrow_status 
            ON escrow_transactions(status)
        """)
        
        logger.info("Таблица создана")
    
    @staticmethod
    def hold_funds(cursor, ad_post_id, buyer_id, blogger_id, amount, commission_rate=0.10):
    
        cursor.execute("""
            INSERT INTO escrow_transactions (
                ad_post_id, buyer_id, blogger_id, amount, commission_rate, status
            )
            VALUES (?, ?, ?, ?, ?, 'held')
        """, (ad_post_id, buyer_id, blogger_id, amount, commission_rate))
        
        transaction_id = cursor.lastrowid
        
        logger.info(
            f"Средства холдированы: escrow_id={transaction_id}, "
            f"ad_post_id={ad_post_id}, amount={amount}, "
            f"buyer={buyer_id}, blogger={blogger_id}"
        )
        
        return transaction_id
    
    @staticmethod
    def get_by_ad_post(cursor, ad_post_id):
   
        cursor.execute("""
            SELECT * FROM escrow_transactions 
            WHERE ad_post_id = ?
        """, (ad_post_id,))
        row = cursor.fetchone()
        if row:
            return dict(row)
        return None
    



    @staticmethod
    def release_to_blogger(cursor, ad_post_id):
        escrow = EscrowTransaction.get_by_ad_post(cursor, ad_post_id)
        
        if not escrow:
            logger.warning(f"транзакция не найдена для ad_post_id={ad_post_id}")
            return None
        
        if escrow['status'] != 'held':
            logger.warning(
                f"уже обработано: ad_post_id={ad_post_id}, "
                f"status={escrow['status']}"
            )
            return None
        

        total_amount = escrow['amount']
        commission_rate = escrow['commission_rate']
        commission_amount = total_amount * commission_rate
        blogger_amount = total_amount - commission_amount
        
    
        cursor.execute("""
            UPDATE escrow_transactions 
            SET status = 'released_to_blogger', released_at = CURRENT_TIMESTAMP
            WHERE ad_post_id = ?
        """, (ad_post_id,))
        
      
        from database.models import User
        User.update_balance(cursor, escrow['blogger_id'], blogger_amount, 'add')
        
        logger.info(
            f"✅ Средства переведены блогеру: ad_post_id={ad_post_id}, "
            f"blogger_id={escrow['blogger_id']}, amount={blogger_amount:.2f}, "
            f"commission={commission_amount:.2f}"
        )
        
        return {
            'blogger_id': escrow['blogger_id'],
            'blogger_amount': blogger_amount,
            'commission_amount': commission_amount,
            'total_amount': total_amount
        }
    
    @staticmethod
    def refund_to_buyer(cursor, ad_post_id):
      
        escrow = EscrowTransaction.get_by_ad_post(cursor, ad_post_id)
        
        if not escrow:
            logger.warning(f"НЕ НАЙДЕНО ad_post_id={ad_post_id}")
            return None
        
        if escrow['status'] != 'held':
            logger.warning(
                f"обработано: ad_post_id={ad_post_id}, "
                f"status={escrow['status']}"
            )
            return None
        
     
        cursor.execute("""
            UPDATE escrow_transactions 
            SET status = 'refunded_to_buyer', released_at = CURRENT_TIMESTAMP
            WHERE ad_post_id = ?
        """, (ad_post_id,))
        

        from database.models import User
        User.update_balance(cursor, escrow['buyer_id'], escrow['amount'], 'add')
        
        logger.info(
            f"средства возвращены покупателю: ad_post_id={ad_post_id}, "
            f"buyer_id={escrow['buyer_id']}, amount={escrow['amount']:.2f}"
        )
        
        return {
            'buyer_id': escrow['buyer_id'],
            'refund_amount': escrow['amount']
        }
    









    
    @staticmethod
    def get_held_transactions(cursor, limit=100):

        cursor.execute("""
            SELECT * FROM escrow_transactions 
            WHERE status = 'held'
            ORDER BY created_at DESC
            LIMIT ?
        """, (limit,))
        return [dict(row) for row in cursor.fetchall()]
    













    @staticmethod
    def get_user_escrow_balance(cursor, user_id):
    
        cursor.execute("""
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM escrow_transactions 
            WHERE buyer_id = ? AND status = 'held'
        """, (user_id,))
        result = cursor.fetchone()
        return result['total'] if result else 0
