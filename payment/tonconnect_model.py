

import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class TonPaymentModel:

    
    @staticmethod
    def create_table(cursor):
   
        try:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS ton_payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    amount_rub REAL NOT NULL,
                    amount_ton REAL NOT NULL,
                    amount_nano INTEGER NOT NULL,
                    ton_price REAL NOT NULL,
                    receiver_wallet TEXT NOT NULL,
                    tx_hash TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    payload TEXT,
                    created_at TEXT NOT NULL,
                    completed_at TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            ''')
            
       
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_ton_payments_user_id 
                ON ton_payments(user_id)
            ''')
            
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_ton_payments_tx_hash 
                ON ton_payments(tx_hash)
            ''')
            
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_ton_payments_status 
                ON ton_payments(status)
            ''')
            
            logger.info("✅ Таблица ton_payments создана/проверена")
            
        except Exception as e:
            logger.error(f"❌ Ошибка создания таблицы ton_payments: {e}")
            raise
    
    @staticmethod
    def create(cursor, user_id, amount_rub, amount_ton, amount_nano, ton_price, 
               receiver_wallet, payload=None):
   
        try:
            created_at = datetime.now().isoformat()
            
            cursor.execute('''
                INSERT INTO ton_payments 
                (user_id, amount_rub, amount_ton, amount_nano, ton_price, 
                 receiver_wallet, payload, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            ''', (user_id, amount_rub, amount_ton, amount_nano, ton_price,
                  receiver_wallet, payload, created_at))
            
            payment_id = cursor.lastrowid
            logger.info(f"✅ TON платёж создан: ID={payment_id}, user_id={user_id}")
            
            return payment_id
            
        except Exception as e:
            logger.error(f"❌ Ошибка создания TON платежа: {e}")
            raise
    
    @staticmethod
    def update_transaction(cursor, payment_id, tx_hash, status='completed'):
    
        try:
            completed_at = datetime.now().isoformat()
            
            cursor.execute('''
                UPDATE ton_payments 
                SET tx_hash = ?, status = ?, completed_at = ?
                WHERE id = ?
            ''', (tx_hash, status, completed_at, payment_id))
            
            logger.info(f"✅ TON платёж обновлён: ID={payment_id}, tx_hash={tx_hash}")
            
        except Exception as e:
            logger.error(f"❌ Ошибка обновления TON платежа: {e}")
            raise
    
    @staticmethod
    def get_by_id(cursor, payment_id):
      
        try:
            logger.info(f"🔍 Запрос платежа ID={payment_id}")
            
            cursor.execute('''
                SELECT * FROM ton_payments WHERE id = ?
            ''', (payment_id,))
            
            row = cursor.fetchone()
            
            logger.info(f"🔍 Row fetched: {row}")
            logger.info(f"🔍 Row type: {type(row)}")
            
            if row:
              
                if isinstance(row, dict):
                    logger.info(f"✅ Row is already a dict, returning as is")
                    return row
                else:
                    # Если по какой-то причине это не словарь, создаем его
                    logger.info(f"⚠️ Row is not a dict, converting...")
                    columns = [description[0] for description in cursor.description]
                    result = dict(zip(columns, row))
                    return result
            
            logger.warning(f"⚠️ Платёж ID={payment_id} не найден")
            return None
            
        except Exception as e:
            logger.error(f"❌ Ошибка получения TON платежа: {e}", exc_info=True)
            raise
    
    @staticmethod
    def get_by_tx_hash(cursor, tx_hash):
     
        try:
            cursor.execute('''
                SELECT * FROM ton_payments WHERE tx_hash = ?
            ''', (tx_hash,))
            
            row = cursor.fetchone()
            
            if row:
        
                return row if isinstance(row, dict) else dict(zip([d[0] for d in cursor.description], row))
            
            return None
            
        except Exception as e:
            logger.error(f"❌ Ошибка получения TON платежа по tx_hash: {e}")
            raise
    
    @staticmethod
    def get_by_user(cursor, user_id, limit=10):
    
        try:
            cursor.execute('''
                SELECT * FROM ton_payments 
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            ''', (user_id, limit))
            
            rows = cursor.fetchall()
            
            if rows:
           
                if isinstance(rows[0], dict):
                    return rows
                
        
                columns = [description[0] for description in cursor.description]
                return [dict(zip(columns, row)) for row in rows]
            
            return []
            
        except Exception as e:
            logger.error(f"❌ Ошибка получения TON платежей пользователя: {e}")
            raise
    
    @staticmethod
    def get_user_total_paid(cursor, user_id):
  
        try:
            cursor.execute('''
                SELECT COALESCE(SUM(amount_rub), 0) 
                FROM ton_payments 
                WHERE user_id = ? AND status = 'completed'
            ''', (user_id,))
            
            result = cursor.fetchone()
            return float(result[0]) if result else 0.0
            
        except Exception as e:
            logger.error(f"❌ Ошибка получения суммы TON платежей: {e}")
            raise
