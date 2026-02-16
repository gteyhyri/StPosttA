class TonPaymentManager {
    constructor() {
        this.currentPaymentId = null;
        this.tonPrice = 0;
        this.isConnected = false;
        this.tonConnectUI = null;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }
    async init() {
        try {
            console.log('🔷 Инициализация TON Connect...');
            console.log('🔷 Проверка window.TON_CONNECT_UI:', typeof TON_CONNECT_UI);
            if (typeof TON_CONNECT_UI === 'undefined') {
                console.warn('⚠️ TON Connect UI не загружен, ждем...');
                await this.waitForTonConnect();
            }
            console.log('🔷 TON_CONNECT_UI доступен, создаем экземпляр...');
            this.tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
                manifestUrl: 'https://beta.heisen.online/api/payment/ton/manifest',
                buttonRootId: null // Не создаем кнопку автоматически
            });
            console.log('🔷 TonConnectUI создан успешно');
            this.tonConnectUI.onStatusChange(wallet => {
                if (wallet) {
                    this.isConnected = true;
                    console.log('✅ Кошелек подключен (onStatusChange):', wallet.account.address);
                } else {
                    this.isConnected = false;
                    console.log('❌ Кошелек отключен (onStatusChange)');
                }
            });
            const currentWallet = this.tonConnectUI.wallet;
            console.log('🔍 Проверка текущего кошелька при инициализации:', currentWallet);
            if (currentWallet && currentWallet.account) {
                this.isConnected = true;
                console.log('✅ Кошелек уже подключен при инициализации:', currentWallet.account.address);
            } else {
                this.isConnected = false;
                console.log('❌ Кошелек не подключен при инициализации');
            }
            console.log('🔷 Загружаем цену TON...');
            await this.loadTonPrice();
            console.log('✅ TON Connect инициализирован успешно');
        } catch (error) {
            console.error('❌ Ошибка инициализации TON Connect:', error);
            console.error('❌ Stack:', error.stack);
            this.tonConnectUI = null;
        }
    }
    isReady() {
        return this.tonConnectUI !== null;
    }
    getWallet() {
        if (!this.tonConnectUI) {
            return null;
        }
        return this.tonConnectUI.wallet;
    }
    getWalletAddress() {
        const wallet = this.getWallet();
        if (wallet && wallet.account && wallet.account.address) {
            return wallet.account.address;
        }
        return null;
    }
    updateConnectionState() {
        const wallet = this.getWallet();
        this.isConnected = !!(wallet && wallet.account && wallet.account.address);
        console.log('🔄 Обновление состояния подключения:', this.isConnected);
        return this.isConnected;
    }
    async waitForReady() {
        if (this.isReady()) {
            return true;
        }
        console.log('⏳ Ожидание инициализации TON Connect...');
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 30; // 3 секунды
            const checkInterval = setInterval(() => {
                attempts++;
                if (this.isReady()) {
                    clearInterval(checkInterval);
                    console.log('✅ TON Connect готов к работе');
                    resolve(true);
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    console.error('❌ Таймаут ожидания TON Connect');
                    reject(new Error('TON Connect не инициализировался. Перезагрузите страницу.'));
                }
            }, 100);
        });
    }
    async waitForTonConnect() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 50; // 5 секунд
            const checkInterval = setInterval(() => {
                attempts++;
                if (typeof TON_CONNECT_UI !== 'undefined') {
                    clearInterval(checkInterval);
                    resolve();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    reject(new Error('TON Connect UI не загрузился'));
                }
            }, 100);
        });
    }
    async loadTonPrice() {
        try {
            const response = await fetch('/api/payment/ton/price', {
                method: 'GET',
                headers: {
                    'Authorization': `tma ${window.Telegram.WebApp.initData}`
                }
            });
            if (!response.ok) {
                throw new Error('Ошибка загрузки цены TON');
            }
            const data = await response.json();
            this.tonPrice = data.price;
            console.log(`💰 Цена TON: ${this.tonPrice} RUB`);
            return this.tonPrice;
        } catch (error) {
            console.error('❌ Ошибка загрузки цены TON:', error);
            this.tonPrice = 300; // Дефолтная цена
            return this.tonPrice;
        }
    }
    convertRubToTon(amountRub) {
        if (this.tonPrice <= 0) {
            return 0;
        }
        return amountRub / this.tonPrice;
    }
    async connectWallet() {
        try {
            console.log('🔷 Подключение кошелька...');
            if (!this.tonConnectUI) {
                throw new Error('TON Connect UI не инициализирован');
            }
            await this.tonConnectUI.openModal();
            return new Promise((resolve, reject) => {
                const unsubscribe = this.tonConnectUI.onStatusChange(wallet => {
                    if (wallet) {
                        unsubscribe();
                        this.isConnected = true;
                        console.log('✅ Кошелек подключен');
                        resolve(wallet);
                    }
                });
                setTimeout(() => {
                    unsubscribe();
                    reject(new Error('Таймаут подключения кошелька'));
                }, 60000);
            });
        } catch (error) {
            console.error('❌ Ошибка подключения кошелька:', error);
            throw error;
        }
    }
    async createPayment(amountRub) {
        try {
            console.log(`💳 Создание TON платежа на сумму ${amountRub} руб.`);
            const initData = window.Telegram.WebApp.initData;
            console.log('🔑 CREATE: initData длина:', initData.length);
            console.log('🔑 CREATE: initData (первые 100):', initData.substring(0, 100));
            console.log('🔑 CREATE: initData (последние 100):', initData.substring(initData.length - 100));
            const response = await fetch('/api/payment/ton/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `tma ${initData}`
                },
                body: JSON.stringify({ amount: amountRub })
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Ошибка создания платежа');
            }
            const data = await response.json();
            console.log('✅ TON платёж создан:', data);
            this.currentPaymentId = data.payment_id;
            if (data.transaction && data.transaction.validUntil) {
                const clientValidUntil = Math.floor(Date.now() / 1000) + 180; // 3 минуты от текущего времени клиента
                console.log(`🕐 Исправление validUntil: ${data.transaction.validUntil} → ${clientValidUntil}`);
                data.transaction.validUntil = clientValidUntil;
            }
            return data;
        } catch (error) {
            console.error('❌ Ошибка создания TON платежа:', error);
            throw error;
        }
    }
    async sendTransaction(transaction) {
        try {
            console.log('📤 Отправка транзакции:', transaction);
            if (!this.tonConnectUI) {
                throw new Error('TON Connect UI не инициализирован');
            }
            const result = await this.tonConnectUI.sendTransaction(transaction);
            console.log('✅ Транзакция отправлена:', result);
            return result;
        } catch (error) {
            console.error('❌ Ошибка отправки транзакции:', error);
            throw error;
        }
    }
    async confirmPayment(paymentId, txHash) {
        try {
            console.log(`✅ Подтверждение платежа: payment_id=${paymentId}, tx_hash=${txHash}`);
            if (!window.Telegram || !window.Telegram.WebApp || !window.Telegram.WebApp.initData) {
                console.error('❌ Telegram WebApp initData недоступен!');
                throw new Error('Ошибка авторизации. Перезагрузите приложение.');
            }
            const initData = window.Telegram.WebApp.initData;
            console.log('🔑 Отправка с initData длиной:', initData.length);
            console.log('🔑 InitData (первые 100 символов):', initData.substring(0, 100));
            console.log('🔑 InitData (последние 100 символов):', initData.substring(initData.length - 100));
            if (!initData || initData.length === 0) {
                console.warn('⚠️ initData пустой, ждем 1 секунду...');
                await new Promise(resolve => setTimeout(resolve, 1000));
                const retryInitData = window.Telegram.WebApp.initData;
                if (!retryInitData || retryInitData.length === 0) {
                    throw new Error('Ошибка авторизации. Перезагрузите приложение.');
                }
            }
            const response = await fetch('/api/payment/ton/confirm', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `tma ${initData}`
                },
                body: JSON.stringify({
                    payment_id: paymentId,
                    tx_hash: txHash
                })
            });
            console.log('📡 Response status:', response.status);
            console.log('📡 Response ok:', response.ok);
            if (!response.ok) {
                const error = await response.json();
                console.error('❌ Ошибка ответа сервера:', error);
                if (response.status === 403) {
                    throw new Error('Ошибка авторизации. Попробуйте перезагрузить приложение.');
                }
                throw new Error(error.error || 'Ошибка подтверждения платежа');
            }
            const data = await response.json();
            console.log('✅ Платёж подтверждён:', data);
            return data;
        } catch (error) {
            console.error('❌ Ошибка подтверждения платежа:', error);
            throw error;
        }
    }
    async checkPaymentStatus(paymentId) {
        try {
            const response = await fetch(`/api/payment/ton/status/${paymentId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `tma ${window.Telegram.WebApp.initData}`
                }
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Ошибка проверки статуса');
            }
            const data = await response.json();
            console.log('📊 Статус TON платежа:', data);
            return data;
        } catch (error) {
            console.error('❌ Ошибка проверки статуса:', error);
            throw error;
        }
    }
    async processTopup(amountRub) {
        try {
            console.log('='.repeat(60));
            console.log(`🔷 Начало пополнения через TON: ${amountRub} RUB`);
            await this.waitForReady();
            if (!this.isConnected) {
                console.log('🔷 Кошелек не подключен, подключаем...');
                await this.connectWallet();
            }
            await this.loadTonPrice();
            const paymentData = await this.createPayment(amountRub);
            const tonAmount = paymentData.amount_ton.toFixed(6);
            console.log(`💱 Сумма к оплате: ${tonAmount} TON (${amountRub} RUB)`);
            const txResult = await this.sendTransaction(paymentData.transaction);
            const txHash = txResult.boc; // Base64 encoded BOC
            const confirmResult = await this.confirmPayment(paymentData.payment_id, txHash);
            console.log('✅ Пополнение успешно завершено!');
            console.log('='.repeat(60));
            return {
                success: true,
                amount_rub: confirmResult.amount_rub,
                payment_id: paymentData.payment_id,
                tx_hash: txHash
            };
        } catch (error) {
            console.error('❌ Ошибка процесса пополнения:', error);
            console.log('='.repeat(60));
            throw error;
        }
    }
}
let tonPaymentManager = null;
function initTonPaymentManager() {
    console.log('🔷 Запуск инициализации TON Payment Manager...');
    console.log('🔷 window.tonConnectLoaded:', window.tonConnectLoaded);
    console.log('🔷 window.tonConnectError:', window.tonConnectError);
    console.log('🔷 TON_CONNECT_UI доступен:', typeof TON_CONNECT_UI !== 'undefined');
    if (window.tonConnectError) {
        console.error('❌ TON Connect UI не загрузился:', window.tonConnectError);
        console.error('❌ Возможно заблокирован CDN или нет интернета');
        return;
    }
    if (typeof TON_CONNECT_UI === 'undefined') {
        console.error('❌ TON_CONNECT_UI не загружен!');
        console.log('⏳ Ждем загрузки библиотеки...');
        setTimeout(() => {
            if (typeof TON_CONNECT_UI !== 'undefined') {
                console.log('✅ TON_CONNECT_UI загружен с задержкой');
                tonPaymentManager = new TonPaymentManager();
                window.tonPaymentManager = tonPaymentManager;
            } else {
                console.error('❌ TON_CONNECT_UI так и не загрузился');
                console.error('❌ Проверьте доступность https://unpkg.com/@tonconnect/ui@latest/dist/tonconnect-ui.min.js');
            }
        }, 2000);
        return;
    }
    tonPaymentManager = new TonPaymentManager();
    window.tonPaymentManager = tonPaymentManager;
    console.log('✅ TON Payment Manager создан');
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTonPaymentManager);
} else {
    setTimeout(initTonPaymentManager, 500);
}
async function handleTonPayment() {
    try {
        const amountInput = document.getElementById('topup-amount');
        if (!amountInput) {
            showNotification('Ошибка: поле ввода суммы не найдено', 'error');
            return;
        }
        const amount = parseFloat(amountInput.value);
        if (!amount || amount <= 0) {
            showNotification('Введите корректную сумму', 'error');
            return;
        }
        if (amount < 1) {
            showNotification('Минимальная сумма пополнения: 1 руб.', 'error');
            return;
        }
        if (amount > 100000) {
            showNotification('Максимальная сумма пополнения: 100 000 руб.', 'error');
            return;
        }
        const tonButton = document.querySelector('.ton-button');
        if (tonButton) {
            tonButton.disabled = true;
            tonButton.textContent = 'Загрузка...';
        }
        if (!tonPaymentManager) {
            showNotification('TON Connect загружается, подождите...', 'warning');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!tonPaymentManager) {
                showNotification('Ошибка загрузки TON Connect. Перезагрузите страницу.', 'error');
                return;
            }
        }
        if (typeof closeBalanceTopupModal === 'function') {
            closeBalanceTopupModal();
        } else {
            const modal = document.getElementById('balance-topup-modal');
            const overlay = document.getElementById('balance-topup-modal-overlay');
            const pageBlurOverlay = document.getElementById('page-blur-overlay');
            if (overlay) {
                overlay.classList.remove('active');
            }
            if (modal) {
                modal.style.display = 'none';
            }
            if (pageBlurOverlay) {
                pageBlurOverlay.classList.remove('active');
            }
            document.body.style.overflow = '';
        }
        showNotification('Инициализация TON Connect...', 'info');
        const result = await tonPaymentManager.processTopup(amount);
        showNotification(`Баланс пополнен на ${result.amount_rub} руб. через TON!`, 'success');
        if (typeof loadUserProfile === 'function') {
            await loadUserProfile();
        }
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        }
    } catch (error) {
        console.error('❌ Ошибка TON пополнения:', error);
        const logs = consoleBuffer.join('\n');
        sendLogsToServer(logs, error.message || String(error));
        let errorMessage = 'Ошибка пополнения через TON';
        if (error.message.includes('User rejects') || error.message.includes('rejected')) {
            errorMessage = 'Транзакция отменена пользователем';
        } else if (error.message.includes('Таймаут') || error.message.includes('timeout')) {
            errorMessage = 'Превышено время ожидания';
        } else if (error.message.includes('не инициализирован') || error.message.includes('Перезагрузите')) {
            errorMessage = 'TON Connect не готов. Попробуйте еще раз или перезагрузите страницу.';
        } else if (error.message) {
            errorMessage = error.message;
        }
        showNotification(errorMessage, 'error');
    } finally {
        const tonButton = document.querySelector('.ton-button');
        if (tonButton) {
            tonButton.disabled = false;
            tonButton.textContent = 'TON';
        }
    }
}
window.handleTonPayment = handleTonPayment;
console.log('✅ TON Connect module loaded');
async function sendLogsToServer(logs, error = '') {
    try {
        const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'unknown';
        await fetch('/api/payment/ton/client-log', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                logs: logs,
                user_id: userId,
                error: error
            })
        });
        console.log('📤 Логи отправлены на сервер');
    } catch (e) {
        console.error('❌ Ошибка отправки логов:', e);
    }
}
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
let consoleBuffer = [];
console.log = function(...args) {
    const message = args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
            try {
                return JSON.stringify(arg, null, 2);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
    consoleBuffer.push(`[LOG] ${message}`);
    if (consoleBuffer.length > 100) {
        consoleBuffer.shift();
    }
    originalConsoleLog.apply(console, args);
};
console.error = function(...args) {
    const message = args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
            try {
                return JSON.stringify(arg, null, 2);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
    consoleBuffer.push(`[ERROR] ${message}`);
    if (consoleBuffer.length > 100) {
        consoleBuffer.shift();
    }
    originalConsoleError.apply(console, args);
};
window.sendTonLogs = function() {
    const logs = consoleBuffer.join('\n');
    sendLogsToServer(logs);
    console.log('✅ Логи отправлены! Проверьте файл ton_client_logs.txt на сервере');
};
console.log('✅ TON Connect logging initialized. Use window.sendTonLogs() to send logs to server');
