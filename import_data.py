import pandas as pd
import glob
import os
import re
from sqlalchemy import create_engine
from sqlalchemy.engine import URL

def sanitize_name(name):
    """Cleans a string to be a valid, readable SQL identifier in Thai."""
    # Convert name to string if it's not already (e.g., int columns)
    name = str(name)
    # Remove file extension if present (for table names)
    name_without_ext = os.path.splitext(name)[0]
    
    # Replace invalid SQL characters with an underscore, but keep Thai characters
    # \w in Python regex with re.UNICODE includes Unicode "word" characters
    # We also keep spaces and numbers for now, will handle spaces next
    sanitized = re.sub(r'[^\w\d\s_]', '_', name_without_ext, flags=re.UNICODE)
    
    # Replace spaces with underscores
    sanitized = sanitized.replace(' ', '_')
    
    # Remove multiple underscores
    sanitized = re.sub(r'_{2,}', '_', sanitized)
    
    # Remove leading/trailing underscores
    sanitized = sanitized.strip('_')
    
    # Truncate to a safe length (e.g., 60 chars) to prevent "too long" errors
    # Be careful not to cut in the middle of a Thai character (which is multi-byte)
    # This simple truncation might still cause issues with multi-byte chars,
    # but it's a pragmatic balance for this general purpose script.
    if len(sanitized.encode('utf-8')) > 64: # MySQL limit for identifiers is 64 bytes
        # A more robust solution would be to find the last valid char within 64 bytes
        # For simplicity, we'll just truncate and hope for the best for very long names
        sanitized = sanitized.encode('utf-8')[:60].decode('utf-8', 'ignore')
        sanitized = sanitized.strip('_') # Clean up if truncation created a trailing underscore

    return sanitized


# --- Main Script ---
print("--- เริ่มกระบวนการนำเข้าข้อมูลเวอร์ชัน 3 (แก้ไขการจัดการภาษาไทย) ---")

# เชื่อมต่อกับ SQL พร้อมระบุ charset=utf8mb4
try:
    db_url = URL.create(
        drivername="mysql+pymysql",
        username="importer",
        password="password",
        host="localhost",
        database="hotel_db",
        query={"charset": "utf8mb4"}
    )
    engine = create_engine(db_url)
    print("เชื่อมต่อฐานข้อมูลสำเร็จ")
except Exception as e:
    print(f"!!! ไม่สามารถเชื่อมต่อฐานข้อมูลได้: {e} !!!")
    exit()

# ค้นหาไฟล์ทั้งหมดในโฟลเดอร์ data
files = glob.glob("data/*")
print(f"พบไฟล์ทั้งหมด {len(files)} ไฟล์ในโฟลเดอร์ data")

success_count = 0
error_count = 0

for file in files:
    file_name = os.path.basename(file)
    
    try:
        print(f"\nกำลังประมวลผล: {file_name}")
        
        # 1. อ่านไฟล์
        if file.lower().endswith('.csv'):
            df = pd.read_csv(file)
        elif file.lower().endswith(('.xlsx', '.xlsm')):
            df = pd.read_excel(file)
        elif file.lower().endswith('.ods'):
            df = pd.read_excel(file, engine='odf') # Specify engine for .ods files
        else:
            print(f"--> ข้ามไฟล์ที่ไม่รู้จัก: {file_name}")
            continue

        # 2. ตรวจสอบว่าไฟล์ว่างหรือไม่
        if df.empty:
            print(f"--> ข้ามไฟล์ที่ว่างเปล่า: {file_name}")
            continue

        # 3. ตรวจสอบจำนวนคอลัมน์ที่มากเกินไป
        if len(df.columns) > 200: # Arbitrary large number to catch obvious cases
            print(f"--> ข้ามไฟล์ที่มีจำนวนคอลัมน์มากเกินไป ({len(df.columns)} คอลัมน์): {file_name}")
            continue
            
        # 4. ทำความสะอาดชื่อคอลัมน์
        original_columns = df.columns
        final_columns_map = {}
        seen_names = {}
        for col_idx, col_name_raw in enumerate(original_columns):
            # Convert column name to string, handle potential non-string headers
            col_name_str = str(col_name_raw)
            sanitized_col_name = sanitize_name(col_name_str)
            
            # Ensure uniqueness by appending _N if a name is duplicated after sanitization
            if sanitized_col_name in seen_names:
                seen_names[sanitized_col_name] += 1
                final_columns_map[col_name_raw] = f"{sanitized_col_name}_{seen_names[sanitized_col_name]}"
            else:
                seen_names[sanitized_col_name] = 0
                final_columns_map[col_name_raw] = sanitized_col_name
        
        df.rename(columns=final_columns_map, inplace=True)


        # 5. ทำความสะอาดชื่อตาราง
        table_name = sanitize_name(os.path.basename(file)) # Sanitize original filename again for table name
        if not table_name:
            print(f"--> ไม่สามารถสร้างชื่อตารางที่ถูกต้องได้จาก: {file_name}")
            continue

        print(f"--> กำลังนำเข้าสู่ตาราง: {table_name}")
        
        # 6. ส่งเข้า SQL
        # Use if_exists='replace' as before, assuming tables are re-imported each time.
        # chunksize helps with large dataframes.
        df.to_sql(table_name, con=engine, if_exists='replace', index=False, chunksize=1000)
        print(f"--- สำเร็จ: นำเข้าข้อมูลสู่ตาราง {table_name} เรียบร้อย ---")
        success_count += 1
        
    except Exception as e:
        print(f"!!! ผิดพลาดที่ไฟล์ {file_name}: {e} !!!")
        error_count += 1

print(f"\n--- จัดการนำเข้าข้อมูลทั้งหมดเสร็จสิ้น! ---")
print(f"สรุป: สำเร็จ {success_count} ไฟล์, ผิดพลาด {error_count} ไฟล์")
