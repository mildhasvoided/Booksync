import os
import sys
import glob

def find_kindle_drive():
    import string
    from ctypes import windll
    drives = []
    bitmask = windll.kernel32.GetLogicalDrives()
    for letter in string.ascii_uppercase:
        if bitmask & 1:
            drives.append(letter)
        bitmask >>= 1
    
    for drive in drives:
        # Kindles typically have a 'documents' and 'system' folder at the root
        if os.path.exists(f"{drive}:\\documents") and os.path.exists(f"{drive}:\\system"):
            return f"{drive}:\\"
    return None

def main():
    print("Searching for Kindle drive...")
    kindle_drive = find_kindle_drive()
    
    if not kindle_drive:
        print("Kindle not found. Please ensure it is plugged in and recognized by Windows.")
        return

    print(f"Kindle found at {kindle_drive}")
    documents_dir = os.path.join(kindle_drive, "documents")
    
    # Find all .sdr folders
    sdr_folders = glob.glob(os.path.join(documents_dir, "**", "*.sdr"), recursive=True)
    
    if not sdr_folders:
        print("No .sdr folders found. Have you opened any AZW3 books on this Kindle yet?")
        return

    print(f"Found {len(sdr_folders)} book data folders.")
    
    # Let's just look at the most recently modified one
    sdr_folders.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    recent_sdr = sdr_folders[0]
    book_name = os.path.basename(recent_sdr).replace('.sdr', '')
    
    print(f"\nMost recently read book: {book_name}")
    
    # Look for the progress file
    progress_files = glob.glob(os.path.join(recent_sdr, "*.azw3r")) + glob.glob(os.path.join(recent_sdr, "*.mbp1"))
    
    if not progress_files:
        print(f"No .azw3r or .mbp1 files found in {recent_sdr}")
        return
        
    target_file = progress_files[0]
    print(f"Reading progress file: {os.path.basename(target_file)}")
    
    # Read and output a hex dump of the first 256 bytes to inspect the header and early records
    with open(target_file, 'rb') as f:
        data = f.read(512)
        
    print("\nHex dump of the first 512 bytes:")
    for i in range(0, len(data), 16):
        chunk = data[i:i+16]
        hex_str = ' '.join(f"{b:02X}" for b in chunk)
        ascii_str = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in chunk)
        print(f"{i:04X}  {hex_str:<48}  |{ascii_str}|")

if __name__ == '__main__':
    main()
