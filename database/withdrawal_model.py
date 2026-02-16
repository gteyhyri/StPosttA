"""
Withdrawal Request Model
Модель для хранения запросов на вывод средств
"""

import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class WithdrawalModel:
    """Модель для работы с запросами на вывод средств"""
    
    @staticmethod
    def create_table(cursor):
        """
        Создать таблицу запросов на вывод если её нет
        
        Args:
            cursor: Курсор БД
        """
        try:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS withdrawal_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    amount REAL NOT NULL,
                    wallet_address TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    admin_message_id INTEGER,
                    created_at TEXT NOT NULL,
                    processed_at TEXT,
                    FOREIGN KEY (user_id) REFERENCES users(user_id)
                )
            ''')
            
            # Создаём индексы для быстрого поиска
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_withdrawal_user_id 
                ON withdrawal_requests(user_id)
            ''')
            
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_withdrawal_status 
                ON withdrawal_requests(status)
            ''')
            
            logger.info("✅ Таблица withdrawal_requests создана/проверена")
            
        except Exception as e:
            logger.error(f"❌ Ошибка создания таблицы withdrawal_requests: {e}")
            raise
    
    @staticmethod
    def create(cursor, user_id, amount, wallet_address):
        """
        Создать запрос на вывод
        
        Args:
            cursor: Курсор БД
            user_id: ID пользователя
            amount: Сумма вывода
            wallet_address: Адрес кошелька
            
        Returns:
            int: ID созданного запроса
        """
        try:
            created_at = datetime.now().isoformat()
            
            cursor.execute('''
                INSERT INTO withdrawal_requests 
                (user_id, amount, wallet_address, status, created_at)
                VALUES (?, ?, ?, 'pending', ?)
            ''', (user_id, amount, wallet_address, created_at))
            
            request_id = cursor.lastrowid
            logger.info(f"✅ Запрос на вывод создан: ID={request_id}, user_id={user_id}, amount={amount}")
            
            return request_id
            
        except Exception as e:
            logger.error(f"❌ Ошибка создания запроса на вывод: {e}")
            raise
    
    @staticmethod
    def get_by_id(cursor, request_id):
        """
        Получить запрос по ID
        
        Args:
            cursor: Курсор БД
            request_id: ID запроса
            
        Returns:
            dict: Данные запроса или None
        """
        try:
            cursor.execute('''
                SELECT * FROM withdrawal_requests WHERE id = ?
            ''', (request_id,))
            
            row = cursor.fetchone()
            
            if row:
                return row if isinstance(row, dict) else dict(zip([d[0] for d in cursor.description], row))
            
            return None
            
        except Exception as e:
            logger.error(f"❌ Ошибка получения запроса на вывод: {e}")
            raise
    
    @staticmethod
    def update_status(cursor, request_id, status, admin_message_id=None):
        """
        Обновить статус запроса
        
        Args:
            cursor: Курсор БД
            request_id: ID запроса
            status: Новый статус (pending, approved, rejected)
            admin_message_id: ID сообщения администратора в боте
        """
        try:
            processed_at = datetime.now().isoformat() if status != 'pending' else None
            
            if admin_message_id:
                cursor.execute('''
                    UPDATE withdrawal_requests 
                    SET status = ?, processed_at = ?, admin_message_id = ?
                    WHERE id = ?
                ''', (status, processed_at, admin_message_id, request_id))
            else:
                cursor.execute('''
                    UPDATE withdrawal_requests 
                    SET status = ?, processed_at = ?
                    WHERE id = ?
                ''', (status, processed_at, request_id))
            
            logger.info(f"✅ Статус запроса на вывод обновлён: ID={request_id}, status={status}")
            
        except Exception as e:
            logger.error(f"❌ Ошибка обновления статуса запроса на вывод: {e}")
            raise
    
    @staticmethod
    def get_by_user(cursor, user_id, limit=10):
        """
        Получить запросы пользователя
        
        Args:
            cursor: Курсор БД
            user_id: ID пользователя
            limit: Максимальное количество записей
            
        Returns:
            list: Список запросов
        """
        try:
            cursor.execute('''
                SELECT * FROM withdrawal_requests 
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
            logger.error(f"❌ Ошибка получения запросов на вывод пользователя: {e}")
            raise
