"""
YooKassa Configuration
Конфигурация для работы с ЮКасса API
"""

import os

# ЮКасса credentials
# Можно задать через переменные окружения, а если их нет — используем значения по умолчанию,
# которые ты прислал (shopId и live-ключ).
YOOKASSA_SHOP_ID = os.environ.get('YOOKASSA_SHOP_ID', '1200718')
YOOKASSA_SECRET_KEY = os.environ.get('YOOKASSA_SECRET_KEY', 'live_M94hd-WspxvWApIEjCRlN76-OagYGW8D9kWrGfm7t9k')

# URL для возврата после оплаты (должен совпадать с настроенным в кабинете ЮКассы)
PAYMENT_RETURN_URL = os.environ.get('PAYMENT_RETURN_URL', 'https://beta.heisen.online/payment/success')

# URL для webhook уведомлений от ЮКасса (должен совпадать с настройками ЮКассы)
PAYMENT_WEBHOOK_URL = os.environ.get('PAYMENT_WEBHOOK_URL', 'https://beta.heisen.online/api/payment/webhook')

# Валюта платежей
PAYMENT_CURRENCY = 'RUB'

# Минимальная и максимальная сумма пополнения
MIN_PAYMENT_AMOUNT = 1.00
MAX_PAYMENT_AMOUNT = 100000.00

# Комиссия (если нужно учитывать)
PAYMENT_COMMISSION_PERCENT = 0.0  # 0% - без комиссии

def validate_config():
    """Проверка наличия необходимых настроек"""
    if not YOOKASSA_SHOP_ID:
        raise ValueError("YOOKASSA_SHOP_ID не установлен в переменных окружения")
    if not YOOKASSA_SECRET_KEY:
        raise ValueError("YOOKASSA_SECRET_KEY не установлен в переменных окружения")
    return True

