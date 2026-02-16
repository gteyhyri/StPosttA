

import os


YOOKASSA_SHOP_ID = os.environ.get('YOOKASSA_SHOP_ID', ' ')
YOOKASSA_SECRET_KEY = os.environ.get('YOOKASSA_SECRET_KEY', ' ')


PAYMENT_RETURN_URL = os.environ.get('PAYMENT_RETURN_URL', ' ')


PAYMENT_WEBHOOK_URL = os.environ.get('PAYMENT_WEBHOOK_URL', ' ')


PAYMENT_CURRENCY = 'RUB'


MIN_PAYMENT_AMOUNT = 1.00
MAX_PAYMENT_AMOUNT = 100000.00


PAYMENT_COMMISSION_PERCENT = 0.0  

def validate_config():

    if not YOOKASSA_SHOP_ID:
        raise ValueError("YOOKASSA_SHOP_ID не установлен в переменных окружения")
    if not YOOKASSA_SECRET_KEY:
        raise ValueError("YOOKASSA_SECRET_KEY не установлен в переменных окружения")
    return True


