

import sys
import os
import sqlite3
import logging


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from payment.payment_model import PaymentModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def init_payment_table():
   
    try:
     
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'telegram_app.db')
        
        if not os.path.exists(db_path):
            logger.error(f"❌ База данных не найдена: {db_path}")
            return False
        
        logger.info(f"📂 Подключение к БД: {db_path}")
        
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
    
        PaymentModel.create_table(cursor)
        conn.commit()
        
       
        cursor.execute("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='payments'
        """)
        
        if cursor.fetchone():
            logger.info("✅ Таблица payments успешно создана/проверена")
            
          
            cursor.execute("PRAGMA table_info(payments)")
            columns = cursor.fetchall()
            
            logger.info("📋 Структура таблицы payments:")
            for col in columns:
                logger.info(f"   - {col['name']} ({col['type']})")
            
            conn.close()
            return True
        else:
            logger.error("❌ Таблица payments не была создана")
            conn.close()
            return False
            
    except Exception as e:
        logger.error(f"❌ Ошибка инициализации таблицы платежей: {e}", exc_info=True)
        return False







if __name__ == '__main__':
    logger.info("=" * 60)

    logger.info("🔧 ИНИЦИАЛИЗАЦИЯ ТАБЛИЦЫ ПЛАТЕЖЕЙ")
    logger.info("=" * 60)

    
    success = init_payment_table()
    
    if success:
        logger.info("=" * 60)

        logger.info("✅ ИНИЦИАЛИЗАЦИЯ ЗАВЕРШЕНА УСПЕШНО")

        logger.info("=" * 60)
    else:
        logger.info("=" * 60)

        
        logger.info("❌ ИНИЦИАЛИЗАЦИЯ ЗАВЕРШЕНА С ОШИБКАМИ")
        logger.info("=" * 60)
        sys.exit(1)

