

import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class PaymentModel:

    
    @staticmethod
    def create_table(cursor):
       
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payment_id TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                currency TEXT DEFAULT 'RUB',
                status TEXT NOT NULL,
                description TEXT,
                confirmation_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                paid_at TIMESTAMP,
                metadata TEXT,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )
        """)
        
       
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_payments_payment_id ON payments(payment_id)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)
        """)
        
        logger.info("Таблица готовп")
    
    @staticmethod
    def create(cursor, payment_id, user_id, amount, currency, status, description, confirmation_url, metadata=None):
   
        cursor.execute("""
            INSERT INTO payments (
                payment_id, user_id, amount, currency, status, 
                description, confirmation_url, metadata
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (payment_id, user_id, amount, currency, status, description, confirmation_url, metadata))
        
        logger.info(f"💳 Платёж создан: payment_id={payment_id}, user_id={user_id}, amount={amount}")
        return cursor.lastrowid
    
    @staticmethod
    def get_by_payment_id(cursor, payment_id):
      
        cursor.execute("""
            SELECT * FROM payments WHERE payment_id = ?
        """, (payment_id,))
        return cursor.fetchone()
    
    @staticmethod
    def get_by_user(cursor, user_id, limit=10):
    
        cursor.execute("""
            SELECT * FROM payments 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ?
        """, (user_id, limit))
        return cursor.fetchall()
    
    @staticmethod
    def update_status(cursor, payment_id, status, paid_at=None):
  
        if paid_at:
            cursor.execute("""
                UPDATE payments 
                SET status = ?, paid_at = ?, updated_at = CURRENT_TIMESTAMP
                WHERE payment_id = ?
            """, (status, paid_at, payment_id))
        else:
            cursor.execute("""
                UPDATE payments 
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE payment_id = ?
            """, (status, payment_id))
        
        logger.info(f"статус платежа обновлен: payment_id={payment_id}, status={status}")
    
    @staticmethod
    def get_pending_payments(cursor, user_id):
     
        cursor.execute("""
            SELECT * FROM payments 
            WHERE user_id = ? AND status = 'pending'
            ORDER BY created_at DESC
        """, (user_id,))
        return cursor.fetchall()
    
    @staticmethod
    def get_user_total_paid(cursor, user_id):
   
        cursor.execute("""
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM payments 
            WHERE user_id = ? AND status = 'succeeded'
        """, (user_id,))
        result = cursor.fetchone()
        return result['total'] if result else 0

