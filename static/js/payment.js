class PaymentManager {
    constructor() {
        this.currentPaymentId = null;
        this.checkInterval = null;
    }
    async createPayment(amount) {
        try {
            console.log(`💳 Создание платежа на сумму ${amount} руб.`);
            const response = await fetch('/api/payment/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `tma ${window.Telegram.WebApp.initData}`
                },
                body: JSON.stringify({ amount })
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Ошибка создания платежа');
            }
            const data = await response.json();
            console.log('✅ Платёж создан:', data);
            return data;
        } catch (error) {
            console.error('❌ Ошибка создания платежа:', error);
            throw error;
        }
    }
    async checkPaymentStatus(paymentId) {
        try {
            const response = await fetch(`/api/payment/status/${paymentId}`, {
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
            console.log('📊 Статус платежа:', data);
            return data;
        } catch (error) {
            console.error('❌ Ошибка проверки статуса:', error);
            throw error;
        }
    }
    openPaymentPage(confirmationUrl) {
        console.log('🌐 Открытие страницы оплаты:', confirmationUrl);
        const paymentWindow = window.open(confirmationUrl, '_blank');
        if (!paymentWindow) {
            console.warn('⚠️ Всплывающее окно заблокировано браузером');
            showNotification('Разрешите всплывающие окна для оплаты', 'warning');
            window.location.href = confirmationUrl;
        }
    }
    startStatusCheck(paymentId, onSuccess, onCancel) {
        console.log('🔄 Начинаем проверку статуса платежа:', paymentId);
        this.currentPaymentId = paymentId;
        let checkCount = 0;
        const maxChecks = 60; 
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        this.checkInterval = setInterval(async () => {
            checkCount++;
            try {
                const status = await this.checkPaymentStatus(paymentId);
                if (status.status === 'succeeded' && status.paid) {
                    console.log('✅ Платёж успешно завершён!');
                    this.stopStatusCheck();
                    if (onSuccess) onSuccess(status);
                } else if (status.status === 'canceled') {
                    console.log('❌ Платёж отменён');
                    this.stopStatusCheck();
                    if (onCancel) onCancel(status);
                } else if (checkCount >= maxChecks) {
                    console.log('⏱️ Превышено время ожидания платежа');
                    this.stopStatusCheck();
                    if (onCancel) onCancel({ status: 'timeout' });
                }
            } catch (error) {
                console.error('❌ Ошибка проверки статуса:', error);
            }
        }, 5000); 
    }
    stopStatusCheck() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
    async getPaymentHistory(limit = 10) {
        try {
            const response = await fetch(`/api/payment/history?limit=${limit}`, {
                method: 'GET',
                headers: {
                    'Authorization': `tma ${window.Telegram.WebApp.initData}`
                }
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Ошибка получения истории');
            }
            const data = await response.json();
            console.log('📜 История платежей:', data);
            return data;
        } catch (error) {
            console.error('❌ Ошибка получения истории:', error);
            throw error;
        }
    }
}
const paymentManager = new PaymentManager();
async function handleBalanceTopup() {
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
        const topupButton = document.querySelector('.topup-button');
        if (topupButton) {
            topupButton.disabled = true;
            topupButton.textContent = 'Создание платежа...';
        }
        const paymentData = await paymentManager.createPayment(amount);
        paymentManager.openPaymentPage(paymentData.confirmation_url);
        showNotification('Перенаправление на страницу оплаты...', 'info');
        const modal = document.getElementById('topup-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        paymentManager.startStatusCheck(
            paymentData.payment_id,
            async (status) => {
                showNotification(`Баланс пополнен на ${status.amount} руб.!`, 'success');
                await loadUserProfile();
                if (window.Telegram && window.Telegram.WebApp) {
                    window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
                }
            },
            (status) => {
                if (status.status === 'timeout') {
                    showNotification('Время ожидания оплаты истекло. Проверьте историю платежей.', 'warning');
                } else {
                    showNotification('Оплата отменена', 'warning');
                }
            }
        );
    } catch (error) {
        console.error('❌ Ошибка пополнения:', error);
        showNotification(error.message || 'Ошибка создания платежа', 'error');
    } finally {
        const topupButton = document.querySelector('.topup-button');
        if (topupButton) {
            topupButton.disabled = false;
            topupButton.textContent = 'Пополнить';
        }
    }
}
async function showPaymentHistory() {
    try {
        const history = await paymentManager.getPaymentHistory(10);
        let historyHTML = `
            <div class="payment-history-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>История платежей</h2>
                        <span class="close-button" onclick="closePaymentHistory()">&times;</span>
                    </div>
                    <div class="modal-body">
        `;
        if (history.payments.length === 0) {
            historyHTML += '<p class="no-payments">Платежей пока нет</p>';
        } else {
            historyHTML += '<div class="payments-list">';
            history.payments.forEach(payment => {
                const statusClass = payment.status === 'succeeded' ? 'success' : 
                                  payment.status === 'pending' ? 'pending' : 'failed';
                const statusText = payment.status === 'succeeded' ? 'Успешно' : 
                                 payment.status === 'pending' ? 'Ожидает' : 'Отменён';
                const date = new Date(payment.created_at).toLocaleString('ru-RU');
                historyHTML += `
                    <div class="payment-item">
                        <div class="payment-info">
                            <div class="payment-amount">${payment.amount} ${payment.currency}</div>
                            <div class="payment-date">${date}</div>
                        </div>
                        <div class="payment-status ${statusClass}">${statusText}</div>
                    </div>
                `;
            });
            historyHTML += '</div>';
            historyHTML += `<div class="total-paid">Всего пополнено: ${history.total_paid} руб.</div>`;
        }
        historyHTML += `
                    </div>
                </div>
            </div>
        `;
        const historyContainer = document.getElementById('payment-history-container');
        if (historyContainer) {
            historyContainer.innerHTML = historyHTML;
            historyContainer.style.display = 'flex';
        }
    } catch (error) {
        console.error('❌ Ошибка получения истории:', error);
        showNotification('Ошибка загрузки истории платежей', 'error');
    }
}
function closePaymentHistory() {
    const historyContainer = document.getElementById('payment-history-container');
    if (historyContainer) {
        historyContainer.style.display = 'none';
    }
}
window.paymentManager = paymentManager;
window.handleBalanceTopup = handleBalanceTopup;
window.showPaymentHistory = showPaymentHistory;
window.closePaymentHistory = closePaymentHistory;
console.log('✅ Payment module loaded');
