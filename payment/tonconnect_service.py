
import logging
import time
import asyncio
import requests
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


TON_RECEIVER_WALLET = "UQBavjrc7HNs-X4nk2jYnQsvKysd24od3sXW5lWacI9Gyxc4"
TON_MANIFEST_URL = "https://beta.heisen.online/tonconnect-manifest.json"
NANO_TON = 1_000_000_000  


class TonConnectService:
 
    
    def __init__(self):
      
        self.receiver_wallet = TON_RECEIVER_WALLET
        self.manifest_url = TON_MANIFEST_URL
        logger.info("✅ TON Connect сервис инициализирован")
    
    def get_ton_price_rub(self) -> float:
   
        try:
      
            response = requests.get(
                'https://api.coingecko.com/api/v3/simple/price',
                params={
                    'ids': 'the-open-network',
                    'vs_currencies': 'rub'
                },
                timeout=5
            )
            
            if response.status_code == 200:
                data = response.json()
                price = data.get('the-open-network', {}).get('rub', 0)
                
                if price > 0:
                    logger.info(f"💰 Текущая цена TON: {price} RUB")
                    return float(price)
            
          
            logger.warning("⚠️ CoinGecko API недоступен, пробуем запасной источник")
            return self._get_ton_price_fallback()
            
        except Exception as e:
            logger.error(f"❌ Ошибка получения цены TON: {e}")
            return self._get_ton_price_fallback()
    
    def _get_ton_price_fallback(self) -> float:
      
        try:
         
            response = requests.get(
                'https://tonapi.io/v2/rates',
                params={'tokens': 'ton', 'currencies': 'rub'},
                timeout=5
            )
            
            if response.status_code == 200:
                data = response.json()
                rates = data.get('rates', {})
                ton_rate = rates.get('TON', {})
                price = ton_rate.get('prices', {}).get('RUB', 0)
                
                if price > 0:
                    logger.info(f"💰 Цена TON (запасной источник): {price} RUB")
                    return float(price)
        
        except Exception as e:
            logger.error(f"❌ Ошибка запасного API: {e}")
        
      
        default_price = 300.0
        logger.warning(f"⚠️ Используем дефолтную цену TON: {default_price} RUB")
        return default_price
    
    def convert_rub_to_ton(self, amount_rub: float) -> float:
       
        
        ton_price = self.get_ton_price_rub()
        
        if ton_price <= 0:
            raise ValueError("Не удалось получить курс TON")
        
        ton_amount = amount_rub / ton_price
        logger.info(f"💱 Конвертация: {amount_rub} RUB = {ton_amount:.6f} TON")
        
        return ton_amount
    
    def convert_ton_to_nano(self, ton_amount: float) -> int:
    
        nano_amount = int(ton_amount * NANO_TON)
        logger.info(f"🔢 Конвертация: {ton_amount} TON = {nano_amount} nano-TON")
        return nano_amount
    
    def create_transaction_request(self, amount_rub: float, user_id: int) -> Dict[str, Any]:
     
        try:
            logger.info("=" * 60)
            logger.info(f"💳 СОЗДАНИЕ TON ТРАНЗАКЦИИ")
            logger.info(f"   Сумма: {amount_rub} RUB")
            logger.info(f"   User ID: {user_id}")
            
         
            ton_amount = self.convert_rub_to_ton(amount_rub)
            
           
            nano_amount = self.convert_ton_to_nano(ton_amount)
            
            
            transaction = {
                'validUntil': int(time.time()) + 180,  
                'messages': [
                    {
                        'address': self.receiver_wallet,
                        'amount': str(nano_amount)
                       
                    }
                ]
            }
            
            logger.info(f"✅ Транзакция создана")
            logger.info(f"   TON: {ton_amount:.6f}")
            logger.info(f"   Nano-TON: {nano_amount}")
            logger.info(f"   Кошелек: {self.receiver_wallet}")
            logger.info(f"   Valid until: {transaction['validUntil']}")
            logger.info("=" * 60)
            
            return {
                'transaction': transaction,
                'amount_rub': amount_rub,
                'amount_ton': ton_amount,
                'amount_nano': nano_amount,
                'ton_price': self.get_ton_price_rub(),
                'payload': f'topup_{user_id}_{int(time.time())}'  
            }
            
        except Exception as e:
            logger.error(f"❌ Ошибка создания транзакции: {e}", exc_info=True)
            logger.info("=" * 60)
            raise
    
    def verify_transaction(self, tx_hash: str) -> Optional[Dict[str, Any]]:
    
        try:
            logger.info(f"🔍 Проверка транзакции: {tx_hash}")
            
          
            response = requests.get(
                f'https://tonapi.io/v2/blockchain/transactions/{tx_hash}',
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                logger.info(f"✅ Транзакция найдена: {data}")
                return data
            else:
                logger.warning(f"⚠️ Транзакция не найдена: {tx_hash}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Ошибка проверки транзакции: {e}", exc_info=True)
            return None
    
    def get_manifest_data(self) -> Dict[str, str]:
    
        return {
            "url": "https://beta.heisen.online",
            "name": "AdMarket",
            "iconUrl": "https://beta.heisen.online/static/pic/free-icon-shop-cart-4408651.png",
            "termsOfUseUrl": "https://beta.heisen.online/terms",
            "privacyPolicyUrl": "https://beta.heisen.online/privacy"
        }
