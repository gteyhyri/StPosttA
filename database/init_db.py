
import os
import sys
import logging


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('app.log'),
        logging.StreamHandler()
    ]
)

from database.db import init_db

if __name__ == '__main__':
    print("=" * 60)
    print("загрузка")
    print("=" * 60)
    
    try:
        result = init_db()
        if result:
            print("\n✅")
        else:
            print("\n❌")
            sys.exit(1)
    except Exception as e:
        print(f"\nОШИБКА: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

