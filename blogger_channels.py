from flask import Blueprint, jsonify, request, g
from functools import wraps
import logging
from database import get_db
from database.models import User, BloggerApplication
import asyncio
import concurrent.futures
import sys
sys.path.append('..')
from utils.sanitizer import InputSanitizer

logger = logging.getLogger(__name__)

blogger_channels_bp = Blueprint('blogger_channels', __name__, url_prefix='/api/blogger/channels')


def run_async(coro, timeout=30):
    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(_run_in_new_loop, coro)
        return future.result(timeout=timeout)


def _run_in_new_loop(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        try:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        except Exception as e:
            logger.debug(f"Error cleaning up event loop: {e}")
        finally:
            try:
                loop.close()
            except Exception as e:
                logger.debug(f"Error closing event loop: {e}")


class BloggerChannel:
    
    @staticmethod
    def create_table(cursor):
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS blogger_channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                channel_link TEXT NOT NULL,
                channel_id TEXT DEFAULT '',
                channel_name TEXT DEFAULT '',
                channel_photo_url TEXT DEFAULT '',
                subscribers_count TEXT DEFAULT '0',
                price TEXT DEFAULT '',
                price_permanent TEXT DEFAULT '',
                topic_group_key TEXT DEFAULT '',
                topic_group_title TEXT DEFAULT '',
                topic_sub_key TEXT DEFAULT '',
                topic_sub_title TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                is_verified INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (user_id)
            )
        """)
        
        try:
            cursor.execute("PRAGMA table_info(blogger_channels)")
            columns = [row[1] for row in cursor.fetchall()]
            
            if 'price_permanent' not in columns:
                logger.info("🔧 Adding price_permanent column to blogger_channels table...")
                cursor.execute("""
                    ALTER TABLE blogger_channels 
                    ADD COLUMN price_permanent TEXT DEFAULT ''
                """)
                logger.info("✅ price_permanent column added successfully!")
        except Exception as e:
            logger.error(f"❌ Error adding price_permanent column: {e}")
    
    @staticmethod
    def create(cursor, user_id, channel_link):
        cursor.execute("""
            INSERT INTO blogger_channels (user_id, channel_link)
            VALUES (?, ?)
        """, (user_id, channel_link))
        return cursor.lastrowid
    
    @staticmethod
    def get_by_id(cursor, channel_id):
        cursor.execute("""
            SELECT * FROM blogger_channels WHERE id = ?
        """, (channel_id,))
        row = cursor.fetchone()
        if row:
            return dict(row)
        return None
    
    @staticmethod
    def get_user_channels(cursor, user_id):
        cursor.execute("""
            SELECT * FROM blogger_channels 
            WHERE user_id = ? 
            ORDER BY created_at DESC
        """, (user_id,))
        return [dict(row) for row in cursor.fetchall()]
    
    @staticmethod
    def update_channel_info(cursor, channel_id, channel_name=None, channel_photo_url=None, 
                           subscribers_count=None, channel_telegram_id=None):
        updates = []
        params = []
        
        if channel_name is not None:
            updates.append("channel_name = ?")
            params.append(channel_name)
        
        if channel_photo_url is not None:
            updates.append("channel_photo_url = ?")
            params.append(channel_photo_url)
        
        if subscribers_count is not None:
            updates.append("subscribers_count = ?")
            params.append(subscribers_count)
        
        if channel_telegram_id is not None:
            updates.append("channel_id = ?")
            params.append(channel_telegram_id)
        
        if updates:
            updates.append("updated_at = CURRENT_TIMESTAMP")
            params.append(channel_id)
            
            query = f"""
                UPDATE blogger_channels 
                SET {', '.join(updates)}
                WHERE id = ?
            """
            cursor.execute(query, params)
    
    @staticmethod
    def update_price(cursor, channel_id, price, price_permanent=None):
        if price_permanent is not None:
            cursor.execute("""
                UPDATE blogger_channels 
                SET price = ?, price_permanent = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (price, price_permanent, channel_id))
        else:
            cursor.execute("""
                UPDATE blogger_channels 
                SET price = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (price, channel_id))
    
    @staticmethod
    def update_topic(cursor, channel_id, topic_group_key, topic_group_title, 
                    topic_sub_key, topic_sub_title):
        cursor.execute("""
            UPDATE blogger_channels 
            SET topic_group_key = ?, topic_group_title = ?,
                topic_sub_key = ?, topic_sub_title = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (topic_group_key, topic_group_title, topic_sub_key, topic_sub_title, channel_id))
    
    @staticmethod
    def set_verified(cursor, channel_id, verified=True):
        cursor.execute("""
            UPDATE blogger_channels 
            SET is_verified = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (1 if verified else 0, channel_id))
    
    @staticmethod
    def set_active(cursor, channel_id, active=True):
        cursor.execute("""
            UPDATE blogger_channels 
            SET is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (1 if active else 0, channel_id))
    
    @staticmethod
    def delete(cursor, channel_id):
        cursor.execute("""
            DELETE FROM blogger_channels WHERE id = ?
        """, (channel_id,))


class ChannelSchedule:
    
    @staticmethod
    def create_table(cursor):
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS channel_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id INTEGER NOT NULL,
                weekday_short TEXT NOT NULL,
                from_time TEXT NOT NULL,
                to_time TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (channel_id) REFERENCES blogger_channels (id) ON DELETE CASCADE
            )
        """)
    
    @staticmethod
    def save_schedule(cursor, channel_id, schedule_data):
        cursor.execute("""
            DELETE FROM channel_schedules WHERE channel_id = ?
        """, (channel_id,))
        
        for day_data in schedule_data:
            cursor.execute("""
                INSERT INTO channel_schedules (channel_id, weekday_short, from_time, to_time)
                VALUES (?, ?, ?, ?)
            """, (channel_id, day_data['weekday_short'], day_data['from_time'], day_data['to_time']))
    
    @staticmethod
    def get_schedule(cursor, channel_id):
        cursor.execute("""
            SELECT * FROM channel_schedules 
            WHERE channel_id = ?
            ORDER BY 
                CASE weekday_short
                    WHEN 'Mon' THEN 1
                    WHEN 'Tue' THEN 2
                    WHEN 'Wed' THEN 3
                    WHEN 'Thu' THEN 4
                    WHEN 'Fri' THEN 5
                    WHEN 'Sat' THEN 6
                    WHEN 'Sun' THEN 7
                END
        """, (channel_id,))
        return [dict(row) for row in cursor.fetchall()]


@blogger_channels_bp.route('/list', methods=['GET'])
def get_channels():
    try:
        from app import validate_init_data, BOT_TOKEN
        from telegram_bot import bot
        
        # Manually check auth
        auth_header = request.headers.get('Authorization', '')
        if not auth_header or not auth_header.startswith('tma '):
            return jsonify({'error': 'Unauthorized'}), 401
        
        init_data_raw = auth_header[4:]
        is_valid, parsed_data = validate_init_data(init_data_raw)
        
        if not is_valid:
            return jsonify({'error': 'Unauthorized'}), 401
        
        user_data = parsed_data.get('user', {})
        user_id = user_data.get('id')
        
        db = get_db()
        cursor = db.cursor()
        
        user = User.get_by_id(cursor, user_id)
        if not user or user.get('user_type') != 'blogger':
            return jsonify({'channels': []})
        
        channels = BloggerChannel.get_user_channels(cursor, user_id)
        
        def refresh_channels_data_sync():
            import requests
            
            updated_channels = []
            for channel in channels:
                if not channel.get('subscribers_count') or channel.get('subscribers_count') == '':
                    channel['subscribers_count'] = '0'
                
                if channel.get('channel_id'):
                    try:
                        url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChat"
                        response = requests.post(url, json={'chat_id': channel['channel_id']}, timeout=10)
                        response.raise_for_status()
                        chat_data = response.json()
                        
                        if chat_data.get('ok'):
                            chat = chat_data['result']
                            channel_name = chat.get('title', '')
                            
                            url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChatMemberCount"
                            response = requests.post(url, json={'chat_id': channel['channel_id']}, timeout=10)
                            response.raise_for_status()
                            count_data = response.json()
                            
                            subscribers_count = '0'
                            if count_data.get('ok'):
                                member_count = count_data['result']
                                subscribers_count = str(member_count) if member_count > 0 else '0'
                            
                            channel_photo_url = channel.get('channel_photo_url', '')
                            if 'photo' in chat and 'big_file_id' in chat['photo']:
                                url = f"https://api.telegram.org/bot{BOT_TOKEN}/getFile"
                                response = requests.post(url, json={'file_id': chat['photo']['big_file_id']}, timeout=10)
                                response.raise_for_status()
                                file_data = response.json()
                                
                                if file_data.get('ok'):
                                    file_path = file_data['result']['file_path']
                                    channel_photo_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"
                            
                            cursor.execute("""
                                UPDATE blogger_channels
                                SET channel_name = ?,
                                    channel_photo_url = ?,
                                    subscribers_count = ?,
                                    updated_at = CURRENT_TIMESTAMP
                                WHERE id = ?
                            """, (channel_name, channel_photo_url, subscribers_count, channel['id']))
                            
                            channel['channel_name'] = channel_name
                            channel['channel_photo_url'] = channel_photo_url
                            channel['subscribers_count'] = subscribers_count
                            
                            logger.info(f"✅ Refreshed channel {channel['id']}: name='{channel_name}', subscribers={subscribers_count}")
                    except Exception as e:
                        logger.error(f"❌ Error refreshing channel {channel['id']}: {e}")
                        if not channel.get('subscribers_count'):
                            channel['subscribers_count'] = '0'
                else:
                    logger.warning(f"⚠️ Channel {channel['id']} has no channel_id, skipping refresh")
                
                updated_channels.append(channel)
            
            return updated_channels
        
        try:
            channels = refresh_channels_data_sync()
            db.commit()
        except Exception as e:
            logger.error(f"Error refreshing channels data: {e}")
        
        return jsonify({
            'channels': channels,
            'count': len(channels)
        })
        
    except Exception as e:
        logger.error(f"Error getting channels: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


@blogger_channels_bp.route('/<int:channel_id>/refresh', methods=['POST'])
def refresh_channel_data(channel_id):
    try:
        from app import validate_init_data, BOT_TOKEN
        from telegram_bot import bot
        
        # Manually check auth
        auth_header = request.headers.get('Authorization', '')
        if not auth_header or not auth_header.startswith('tma '):
            return jsonify({'error': 'Unauthorized'}), 401
        
        init_data_raw = auth_header[4:]
        is_valid, parsed_data = validate_init_data(init_data_raw)
        
        if not is_valid:
            return jsonify({'error': 'Unauthorized'}), 401
        
        user_data = parsed_data.get('user', {})
        user_id = user_data.get('id')
        
        db = get_db()
        cursor = db.cursor()
        
        channel = BloggerChannel.get_by_id(cursor, channel_id)
        if not channel:
            return jsonify({'error': 'Канал не найден'}), 404
        
        if channel['user_id'] != user_id:
            return jsonify({'error': 'Доступ запрещен'}), 403
        
        channel_telegram_id = channel.get('channel_id')
        if not channel_telegram_id:
            return jsonify({'error': 'Канал не верифицирован'}), 400
        
        def refresh_from_telegram_sync():
            import requests
            
            try:
                url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChat"
                response = requests.post(url, json={'chat_id': channel_telegram_id}, timeout=10)
                response.raise_for_status()
                chat_data = response.json()
                
                if not chat_data.get('ok'):
                    raise Exception(f"Telegram API error: {chat_data.get('description', 'Unknown error')}")
                
                chat = chat_data['result']
                channel_name = chat.get('title', '')
                
                channel_photo_url = ''
                if 'photo' in chat and 'big_file_id' in chat['photo']:
                    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getFile"
                    response = requests.post(url, json={'file_id': chat['photo']['big_file_id']}, timeout=10)
                    response.raise_for_status()
                    file_data = response.json()
                    
                    if file_data.get('ok'):
                        file_path = file_data['result']['file_path']
                        channel_photo_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"
                
                subscribers_count = '0'
                try:
                    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChatMemberCount"
                    response = requests.post(url, json={'chat_id': channel_telegram_id}, timeout=10)
                    response.raise_for_status()
                    count_data = response.json()
                    
                    if count_data.get('ok'):
                        member_count = count_data['result']
                        if member_count >= 1000:
                            subscribers_count = f"{member_count // 1000}K"
                        elif member_count > 0:
                            subscribers_count = str(member_count)
                        else:
                            subscribers_count = '0'
                        logger.info(f"📊 Refreshed subscribers: {subscribers_count} (raw: {member_count})")
                except Exception as e:
                    logger.error(f"❌ Error getting subscribers count: {e}")
                    subscribers_count = '0'
                
                return {
                    'success': True,
                    'channel_name': channel_name,
                    'channel_photo_url': channel_photo_url,
                    'subscribers_count': subscribers_count
                }
            except Exception as e:
                logger.error(f"Error refreshing channel data: {e}")
                return {
                    'success': False,
                    'error': str(e)
                }
        
        try:
            result = refresh_from_telegram_sync()
        except Exception as e:
            logger.error(f"Error running refresh: {e}")
            return jsonify({
                'success': False,
                'error': f'Ошибка обновления: {str(e)}'
            }), 400
        
        if not result['success']:
            return jsonify(result), 400
        
        BloggerChannel.update_channel_info(
            cursor, 
            channel_id,
            channel_name=result['channel_name'],
            channel_photo_url=result['channel_photo_url'],
            subscribers_count=result['subscribers_count']
        )
        
        db.commit()
        
        logger.info(f"Channel {channel_id} data refreshed: {result['subscribers_count']} subscribers")
        
        return jsonify({
            'success': True,
            'channel_name': result['channel_name'],
            'channel_photo_url': result['channel_photo_url'],
            'subscribers_count': result['subscribers_count']
        })
        
    except Exception as e:
        logger.error(f"Error refreshing channel data: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


@blogger_channels_bp.route('/add', methods=['POST'])
def add_channel():
    try:
        from app import validate_init_data
        
        auth_header = request.headers.get('Authorization', '')
        if not auth_header or not auth_header.startswith('tma '):
            return jsonify({'error': 'Unauthorized'}), 401
        
        init_data_raw = auth_header[4:]
        is_valid, parsed_data = validate_init_data(init_data_raw)
        
        if not is_valid:
            return jsonify({'error': 'Unauthorized'}), 401
        
        user_data = parsed_data.get('user', {})
        user_id = user_data.get('id')
        
        data = request.json
        channel_link = data.get('channel_link')
        
        if not channel_link:
            return jsonify({'error': 'Ссылка на канал обязательна'}), 400
        
        if not ('t.me' in channel_link.lower() or 'telegram.me' in channel_link.lower()):
            return jsonify({'error': 'Пожалуйста, укажите корректную ссылку на Telegram-канал'}), 400
        
        db = get_db()
        cursor = db.cursor()
        
        user = User.get_by_id(cursor, user_id)
        if not user:
            return jsonify({'error': 'Пользователь не найден'}), 404
        
        if user.get('user_type') != 'blogger':
            cursor.execute("""
                UPDATE users 
                SET user_type = 'blogger'
                WHERE user_id = ?
            """, (user_id,))
            logger.info(f"User {user_id} upgraded to blogger")
        
        channel_id = BloggerChannel.create(cursor, user_id, channel_link)
        db.commit()
        
        logger.info(f"New channel added: ID={channel_id}, User={user_id}, Link={channel_link}")
        
        return jsonify({
            'success': True,
            'channel_id': channel_id,
            'message': 'Канал добавлен. Теперь добавьте бота в канал администратором и нажмите "Проверить".',
            'next_step': 'add_bot'
        })
        
    except Exception as e:
        logger.error(f"Error adding channel: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


@blogger_channels_bp.route('/<int:channel_id>/verify', methods=['POST'])
def verify_channel(channel_id):
    try:
        from app import validate_init_data, BOT_TOKEN
        from telegram_bot import notify_admin_about_channel
        import re
        
        auth_header = request.headers.get('Authorization', '')
        if not auth_header or not auth_header.startswith('tma '):
            return jsonify({'error': 'Unauthorized'}), 401
        
        init_data_raw = auth_header[4:]
        is_valid, parsed_data = validate_init_data(init_data_raw)
        
        if not is_valid:
            return jsonify({'error': 'Unauthorized'}), 401
        
        user_data = parsed_data.get('user', {})
        user_id = user_data.get('id')
        
        db = get_db()
        cursor = db.cursor()
        
        channel = BloggerChannel.get_by_id(cursor, channel_id)
        if not channel:
            return jsonify({'error': 'Канал не найден'}), 404
        
        if channel['user_id'] != user_id:
            return jsonify({'error': 'Доступ запрещен'}), 403
        
        if channel.get('is_verified') and channel.get('topic_sub_key'):
            return jsonify({
                'verified': True,
                'approved': True,
                'message': 'Канал уже одобрен администратором'
            })
        
        channel_link = channel['channel_link']
        channel_username = None
        
        patterns = [
            r't\.me/([^/\?]+)',
            r'telegram\.me/([^/\?]+)',
            r'@(\w+)'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, channel_link)
            if match:
                channel_username = match.group(1)
                if not channel_username.startswith('@'):
                    channel_username = '@' + channel_username
                break
        
        if not channel_username:
            return jsonify({
                'verified': False,
                'message': 'Не удалось определить username канала'
            }), 400
        
        logger.info(f"📢 Checking channel: {channel_username}")
        
        import requests
        
        def check_bot_status_sync():
            try:
                url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChat"
                response = requests.post(url, json={'chat_id': channel_username}, timeout=10)
                response.raise_for_status()
                chat_data = response.json()
                
                if not chat_data.get('ok'):
                    raise Exception(f"Telegram API error: {chat_data.get('description', 'Unknown error')}")
                
                chat = chat_data['result']
                telegram_channel_id = str(chat['id'])
                channel_name = chat.get('title', '')
                logger.info(f"✅ Channel found! ID: {telegram_channel_id}, Title: {channel_name}")
                
                bot_info_url = f"https://api.telegram.org/bot{BOT_TOKEN}/getMe"
                bot_info_response = requests.get(bot_info_url, timeout=10)
                bot_info_response.raise_for_status()
                bot_info_data = bot_info_response.json()
                
                if not bot_info_data.get('ok'):
                    raise Exception(f"Failed to get bot info: {bot_info_data.get('description', 'Unknown error')}")
                
                bot_user_id = bot_info_data['result']['id']
                logger.info(f"🤖 Bot user ID: {bot_user_id}")
                
                url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChatMember"
                response = requests.post(url, json={
                    'chat_id': channel_username,
                    'user_id': bot_user_id
                }, timeout=10)
                response.raise_for_status()
                member_data = response.json()
                
                if not member_data.get('ok'):
                    raise Exception(f"Telegram API error: {member_data.get('description', 'Unknown error')}")
                
                bot_status = member_data['result']['status']
                logger.info(f"🤖 Bot status in channel: {bot_status}")
                
                is_bot_admin = bot_status in ['administrator', 'creator']
                if is_bot_admin:
                    logger.info("✅ Bot IS an administrator in the channel!")
                else:
                    logger.info(f"❌ Bot is NOT an administrator (status: {bot_status})")
                
                channel_photo_url = ''
                if 'photo' in chat:
                    photo = chat['photo']
                    if 'big_file_id' in photo:
                        url = f"https://api.telegram.org/bot{BOT_TOKEN}/getFile"
                        response = requests.post(url, json={'file_id': photo['big_file_id']}, timeout=10)
                        response.raise_for_status()
                        file_data = response.json()
                        
                        if file_data.get('ok'):
                            file_path = file_data['result']['file_path']
                            channel_photo_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"
                
                subscribers_count = '0'
                try:
                    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChatMemberCount"
                    response = requests.post(url, json={'chat_id': channel_username}, timeout=10)
                    response.raise_for_status()
                    count_data = response.json()
                    
                    if count_data.get('ok'):
                        member_count = count_data['result']
                        if member_count >= 1000:
                            subscribers_count = f"{member_count // 1000}K"
                        elif member_count > 0:
                            subscribers_count = str(member_count)
                        else:
                            subscribers_count = '0'
                        logger.info(f"📊 Channel subscribers: {subscribers_count} (raw: {member_count})")
                except Exception as e:
                    logger.error(f"❌ Error getting subscribers count: {e}")
                    subscribers_count = '0'
                
                return {
                    'is_admin': is_bot_admin,
                    'telegram_channel_id': telegram_channel_id,
                    'channel_name': channel_name,
                    'channel_photo_url': channel_photo_url,
                    'subscribers_count': subscribers_count
                }
            except Exception as e:
                logger.error(f"❌ Error checking bot status: {e}", exc_info=True)
                raise
        
        try:
            result = check_bot_status_sync()
        except Exception as e:
            logger.error(f"Error running verification: {e}", exc_info=True)
            return jsonify({
                'verified': False,
                'message': f'Не удалось проверить статус бота в канале. Убедитесь, что канал публичный и бот добавлен как администратор. Ошибка: {str(e)}'
            }), 400
        
        if not result['is_admin']:
            logger.info("❌ Bot not added to channel as admin")
            return jsonify({
                'verified': False,
                'message': 'Бот не добавлен в канал как администратор. Пожалуйста, добавьте бота администратором с правами на отправку сообщений.'
            }), 400
            
        logger.info(f"💾 Saving channel data: name={result['channel_name']}, subscribers={result['subscribers_count']}, photo={bool(result['channel_photo_url'])}")
        
        BloggerChannel.update_channel_info(
            cursor, 
            channel_id,
            channel_name=result['channel_name'],
            channel_photo_url=result['channel_photo_url'],
            subscribers_count=result['subscribers_count'],
            channel_telegram_id=result['telegram_channel_id']
        )
        BloggerChannel.set_verified(cursor, channel_id, True)
        
        db.commit()
        
        logger.info(f"✅ Channel {channel_id} verified and saved with {result['subscribers_count']} subscribers")
        
        try:
            import requests
            import json
            import os
            
            BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '8501227640:AAEnvc8VZa5ga3_8uN5isjUH4cGKFaCmw8c')
            ADMIN_ID = 6870552881
            
            logger.info(f"📤 Sending notification to admin about channel #{channel_id}")
            
            cursor.execute("""
                SELECT bc.*, u.first_name, u.last_name, u.username, u.user_id
                FROM blogger_channels bc
                JOIN users u ON bc.user_id = u.user_id
                WHERE bc.id = ?
            """, (channel_id,))
            
            channel_row = cursor.fetchone()
            if channel_row:
                channel_data = dict(channel_row)
                
                username = f"@{channel_data['username']}" if channel_data['username'] else "Не указан"
                full_name = f"{channel_data['first_name']} {channel_data['last_name']}".strip()
                channel_name = channel_data.get('channel_name') or 'Не указано'
                subscribers = channel_data.get('subscribers_count') or '0'
                
                message_text = (
                    "🆕 <b>Новый канал на одобрение</b>\n\n"
                    f"👤 <b>Блогер:</b> {full_name}\n"
                    f"🆔 <b>ID:</b> <code>{channel_data['user_id']}</code>\n"
                    f"📱 <b>Username:</b> {username}\n"
                    f"📢 <b>Канал:</b> {channel_name}\n"
                    f"👥 <b>Подписчики:</b> {subscribers}\n"
                    f"🔗 <b>Ссылка:</b> {channel_data['channel_link']}\n"
                    f"✅ <b>Бот добавлен:</b> Да\n\n"
                    f"<i>Канал #{channel_id}</i>"
                )
                
                keyboard = {
                    "inline_keyboard": [
                        [
                            {"text": "✅ Одобрить", "callback_data": f"approve_channel_{channel_id}"},
                            {"text": "❌ Отклонить", "callback_data": f"reject_channel_{channel_id}"}
                        ]
                    ]
                }
                
                url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
                payload = {
                    "chat_id": ADMIN_ID,
                    "text": message_text,
                    "parse_mode": "HTML",
                    "reply_markup": json.dumps(keyboard)
                }
                
                response = requests.post(url, json=payload, timeout=10)
                response.raise_for_status()
                result_msg = response.json()
                
                if result_msg.get('ok'):
                    logger.info(f"✅ Admin notified successfully about channel #{channel_id}")
                else:
                    logger.error(f"❌ Telegram API error: {result_msg.get('description', 'Unknown error')}")
            else:
                logger.error(f"❌ Channel {channel_id} not found for notification")
                
        except Exception as e:
            logger.error(f"❌ Error notifying admin: {e}", exc_info=True)
        
        return jsonify({
            'verified': True,
            'approved': False,
            'message': 'Канал подтвержден! Заявка отправлена администратору на одобрение.',
            'channel_name': result['channel_name'],
            'subscribers_count': result['subscribers_count']
        })
        
    except Exception as e:
        logger.error(f"Error verifying channel: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


@blogger_channels_bp.route('/<int:channel_id>/update', methods=['POST'])
def update_channel(channel_id):
    try:
        from app import validate_init_data
        
        auth_header = request.headers.get('Authorization', '')
        if not auth_header or not auth_header.startswith('tma '):
            return jsonify({'error': 'Unauthorized'}), 401
        
        init_data_raw = auth_header[4:]
        is_valid, parsed_data = validate_init_data(init_data_raw)
        
        if not is_valid:
            return jsonify({'error': 'Unauthorized'}), 401
        
        user_data = parsed_data.get('user', {})
        user_id = user_data.get('id')
        
        db = get_db()
        cursor = db.cursor()
        
        channel = BloggerChannel.get_by_id(cursor, channel_id)
        if not channel:
            return jsonify({'error': 'Канал не найден'}), 404
        
        if channel['user_id'] != user_id:
            return jsonify({'error': 'Доступ запрещен'}), 403
        
        data = request.json
        
        if 'price' in data:
            price_12h = data['price']
            price_permanent = data.get('price_permanent', None)
            BloggerChannel.update_price(cursor, channel_id, price_12h, price_permanent)
        
        if 'topic' in data:
            topic = data['topic']
            BloggerChannel.update_topic(
                cursor, 
                channel_id,
                topic.get('group_key', ''),
                topic.get('group_title', ''),
                topic.get('sub_key', ''),
                topic.get('sub_title', '')
            )
        
        if 'is_active' in data:
            BloggerChannel.set_active(cursor, channel_id, data['is_active'])
        
        db.commit()
        
        return jsonify({
            'success': True,
            'message': 'Канал обновлен'
        })
        
    except Exception as e:
        logger.error(f"Error updating channel: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


@blogger_channels_bp.route('/<int:channel_id>/schedule', methods=['GET', 'POST'])
def channel_schedule(channel_id):
    try:
        from app import validate_init_data
        
        auth_header = request.headers.get('Authorization', '')
        if not auth_header or not auth_header.startswith('tma '):
            return jsonify({'error': 'Unauthorized'}), 401
        
        init_data_raw = auth_header[4:]
        is_valid, parsed_data = validate_init_data(init_data_raw)
        
        if not is_valid:
            return jsonify({'error': 'Unauthorized'}), 401
        
        user_data = parsed_data.get('user', {})
        user_id = user_data.get('id')
        
        db = get_db()
        cursor = db.cursor()
        
        channel = BloggerChannel.get_by_id(cursor, channel_id)
        if not channel:
            return jsonify({'error': 'Канал не найден'}), 404
        
        if channel['user_id'] != user_id:
            return jsonify({'error': 'Доступ запрещен'}), 403
        
        if request.method == 'GET':
            schedule = ChannelSchedule.get_schedule(cursor, channel_id)
            return jsonify({
                'schedule': schedule
            })
        
        else:
            data = request.json
            schedule_data = data.get('schedule', [])
            
            ChannelSchedule.save_schedule(cursor, channel_id, schedule_data)
            db.commit()
            
            return jsonify({
                'success': True,
                'message': 'График постов сохранен'
            })
        
    except Exception as e:
        logger.error(f"Error with channel schedule: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


@blogger_channels_bp.route('/<int:channel_id>/delete', methods=['DELETE'])
def delete_channel(channel_id):
    try:
        from app import validate_init_data
        
        auth_header = request.headers.get('Authorization', '')
        if not auth_header or not auth_header.startswith('tma '):
            return jsonify({'error': 'Unauthorized'}), 401
        
        init_data_raw = auth_header[4:]
        is_valid, parsed_data = validate_init_data(init_data_raw)
        
        if not is_valid:
            return jsonify({'error': 'Unauthorized'}), 401
        
        user_data = parsed_data.get('user', {})
        user_id = user_data.get('id')
        
        db = get_db()
        cursor = db.cursor()
        
        channel = BloggerChannel.get_by_id(cursor, channel_id)
        if not channel:
            logger.warning(f"❌ Channel {channel_id} not found for deletion")
            return jsonify({'error': 'Канал не найден'}), 404
        
        if channel['user_id'] != user_id:
            logger.warning(f"❌ User {user_id} tried to delete channel {channel_id} owned by {channel['user_id']}")
            return jsonify({'error': 'Доступ запрещен'}), 403
        
        logger.info(f"🗑️ Deleting channel {channel_id} (name: {channel.get('channel_name')}) for user {user_id}")
        
        BloggerChannel.delete(cursor, channel_id)
        db.commit()
        
        logger.info(f"✅ Channel {channel_id} successfully deleted from database by user {user_id}")
        
        return jsonify({
            'success': True,
            'message': 'Канал удален'
        })
        
    except Exception as e:
        logger.error(f"❌ Error deleting channel: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500


@blogger_channels_bp.route('/<int:channel_id>/photo/upload', methods=['POST'])
def upload_channel_photo(channel_id):
    try:
        from app import validate_init_data
        import os
        from werkzeug.utils import secure_filename
        
        auth_header = request.headers.get('Authorization', '')
        if not auth_header or not auth_header.startswith('tma '):
            return jsonify({'error': 'Unauthorized'}), 401
        
        init_data_raw = auth_header[4:]
        is_valid, parsed_data = validate_init_data(init_data_raw)
        
        if not is_valid:
            return jsonify({'error': 'Unauthorized'}), 401
        
        user_data = parsed_data.get('user', {})
        user_id = user_data.get('id')
        
        db = get_db()
        cursor = db.cursor()
        
        channel = BloggerChannel.get_by_id(cursor, channel_id)
        if not channel:
            return jsonify({'error': 'Канал не найден'}), 404
        
        if channel['user_id'] != user_id:
            return jsonify({'error': 'Доступ запрещен'}), 403
        
        if 'photo' not in request.files:
            return jsonify({'error': 'Файл не найден'}), 400
        
        file = request.files['photo']
        
        if file.filename == '':
            return jsonify({'error': 'Файл не выбран'}), 400
        
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        
        if file_ext not in allowed_extensions:
            return jsonify({'error': 'Неподдерживаемый формат файла'}), 400
        
        import uuid
        filename = f"channel_{channel_id}_{uuid.uuid4().hex[:8]}.{file_ext}"
        
        upload_dir = os.path.join('static', 'uploads', 'channels')
        os.makedirs(upload_dir, exist_ok=True)
        
        filepath = os.path.join(upload_dir, filename)
        file.save(filepath)
        
        photo_url = f"/static/uploads/channels/{filename}"
        BloggerChannel.update_channel_info(
            cursor,
            channel_id,
            channel_photo_url=photo_url
        )
        
        db.commit()
        
        logger.info(f"Channel {channel_id} photo uploaded: {filename}")
        
        return jsonify({
            'success': True,
            'photo_url': photo_url,
            'message': 'Фото успешно загружено'
        })
        
    except Exception as e:
        logger.error(f"Error uploading channel photo: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500

