

import re
import html
from typing import Any, Dict, List, Union


class InputSanitizer:
 
    
    
    DANGEROUS_TAGS = [
        'script', 'iframe', 'object', 'embed', 'applet',
        'meta', 'link', 'style', 'base', 'form'
    ]
    

    DANGEROUS_ATTRS = [
        'onclick', 'onload', 'onerror', 'onmouseover',
        'onfocus', 'onblur', 'onchange', 'onsubmit'
    ]
    
    @staticmethod
    def sanitize_string(value: str, max_length: int = None) -> str:
     
        if not isinstance(value, str):
            value = str(value)
        
       
        value = html.escape(value)
        
       
        value = value.replace('\x00', '')
        
     
        if max_length and len(value) > max_length:
            value = value[:max_length]
        
        return value.strip()
    
    @staticmethod
    def sanitize_html(value: str) -> str:
   
        if not isinstance(value, str):
            return ""
        
     
        for tag in InputSanitizer.DANGEROUS_TAGS:
            pattern = re.compile(f'<{tag}[^>]*>.*?</{tag}>', re.IGNORECASE | re.DOTALL)
            value = pattern.sub('', value)
            
            pattern = re.compile(f'<{tag}[^>]*/?>', re.IGNORECASE)
            value = pattern.sub('', value)
        
        
        for attr in InputSanitizer.DANGEROUS_ATTRS:
            pattern = re.compile(f'{attr}\\s*=\\s*["\'][^"\']*["\']', re.IGNORECASE)
            value = pattern.sub('', value)
        
        return value
    
    @staticmethod
    def sanitize_number(value: Any, min_val: float = None, max_val: float = None) -> float:
    
        try:
            num = float(value)
            
            if min_val is not None and num < min_val:
                num = min_val
            
            if max_val is not None and num > max_val:
                num = max_val
            
            return num
        except (ValueError, TypeError):
            return 0.0
    
    @staticmethod
    def sanitize_int(value: Any, min_val: int = None, max_val: int = None) -> int:
     
        try:
            num = int(value)
            
            if min_val is not None and num < min_val:
                num = min_val
            
            if max_val is not None and num > max_val:
                num = max_val
            
            return num
        except (ValueError, TypeError):
            return 0
    
    @staticmethod
    def sanitize_url(value: str) -> str:
     
        if not isinstance(value, str):
            return ""
        
     
        value = value.strip()
        
    
        if not value.startswith(('http://', 'https://')):
            return ""
        
      
        value = re.sub(r'[<>"\']', '', value)
        
        return value
    
    @staticmethod
    def sanitize_dict(data: Dict[str, Any], rules: Dict[str, Dict] = None) -> Dict[str, Any]:



        """
 
        
        rules = {
            'field_name': {
                'type': 'string',  # string, int, float, url, html
                'max_length': 100,
                'min_val': 0,
                'max_val': 1000,
                'required': True
            }
        }
        """







        if not isinstance(data, dict):
            return {}
        
        if not rules:
        
            return {
                k: InputSanitizer.sanitize_string(v) if isinstance(v, str) else v
                for k, v in data.items()
            }
        
        sanitized = {}
        
        for field, rule in rules.items():
            value = data.get(field)
            
       
            if rule.get('required') and value is None:
                continue
            
            if value is None:
                sanitized[field] = None
                continue
            
        
            field_type = rule.get('type', 'string')
            
            if field_type == 'string':
                max_length = rule.get('max_length')
                sanitized[field] = InputSanitizer.sanitize_string(value, max_length)
            
            elif field_type == 'int':
                min_val = rule.get('min_val')
                max_val = rule.get('max_val')
                sanitized[field] = InputSanitizer.sanitize_int(value, min_val, max_val)
            
            elif field_type == 'float':
                min_val = rule.get('min_val')
                max_val = rule.get('max_val')
                sanitized[field] = InputSanitizer.sanitize_number(value, min_val, max_val)
            
            elif field_type == 'url':
                sanitized[field] = InputSanitizer.sanitize_url(value)
            
            elif field_type == 'html':
                sanitized[field] = InputSanitizer.sanitize_html(value)
            
            else:
                sanitized[field] = value
        
        return sanitized
    
    @staticmethod
    def sanitize_list(data: List[Any], item_type: str = 'string', max_items: int = None) -> List[Any]:
    
        if not isinstance(data, list):
            return []
        
      
        if max_items and len(data) > max_items:
            data = data[:max_items]
        
     
        sanitized = []
        for item in data:
            if item_type == 'string':
                sanitized.append(InputSanitizer.sanitize_string(item))
            elif item_type == 'int':
                sanitized.append(InputSanitizer.sanitize_int(item))
            elif item_type == 'float':
                sanitized.append(InputSanitizer.sanitize_number(item))
            else:
                sanitized.append(item)
        
        return sanitized
