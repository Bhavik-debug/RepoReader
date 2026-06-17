import os
import logging

logger = logging.getLogger(__name__)

def is_valid_file(file_path: str) -> bool:
    """
    Checks if a file path points to a file that is eligible for indexing.
    Filters out lockfiles, node_modules, binary formats, images, fonts, etc.
    """
    # Normalize paths to use forward slashes
    normalized_path = file_path.replace("\\", "/")
    
    # Exclude directories
    exclude_dirs = [
        'node_modules', 'bower_components', '.git', 'dist', 'build', 
        'venv', '.venv', '__pycache__', '.idea', '.vscode', 'coverage',
        '.github', 'out', 'bin', 'obj'
    ]
    for d in exclude_dirs:
        if f"/{d}/" in f"/{normalized_path}/":
            return False
            
    # Exclude specific lockfiles and metadata files
    exclude_files = {
        'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 
        'cargo.lock', '.ds_store', '.env', '.gitignore', '.gitattributes',
        'license', 'readme.md', 'contributing.md', 'changelog.md'
    }
    filename = os.path.basename(normalized_path).lower()
    if filename in exclude_files or filename.startswith('.env.'):
        return False
        
    # Exclude media, binary, zipped and font extensions
    exclude_extensions = {
        # Images
        '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.tiff', '.bmp',
        # Audio/Video
        '.mp3', '.mp4', '.wav', '.avi', '.mkv', '.mov', '.flac',
        # Archive
        '.zip', '.tar', '.gz', '.rar', '.7z', '.tgz',
        # Executables/Binaries
        '.exe', '.dll', '.so', '.dylib', '.pyc', '.o', '.bin', '.class', '.jar', '.war', '.pdb',
        # Fonts
        '.ttf', '.woff', '.woff2', '.eot',
        # Others
        '.pdf', '.docx', '.xlsx', '.pptx', '.db', '.sqlite', '.csv'
    }
    _, ext = os.path.splitext(filename)
    if ext in exclude_extensions:
        return False
        
    return True

def chunk_file(file_path: str, base_dir: str, chunk_size: int = 1500, overlap: int = 300):
    """
    Reads a file and splits it line-by-line into character-based sliding window chunks.
    Ensures that lines are not cut in half.
    """
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
    except Exception as e:
        logger.error(f"Error reading file {file_path}: {e}")
        return []
        
    chunks = []
    current_lines = []
    current_length = 0
    start_line = 1
    
    # Calculate path relative to the repository base directory
    rel_path = os.path.relpath(file_path, base_dir).replace("\\", "/")
    file_name = os.path.basename(file_path)
    
    for idx, line in enumerate(lines):
        line_num = idx + 1
        current_lines.append(line)
        current_length += len(line)
        
        # If current chunk exceeds desired size
        if current_length >= chunk_size:
            raw_code = "".join(current_lines)
            chunks.append({
                "file_path": rel_path,
                "file_name": file_name,
                "raw_code_content": raw_code,
                "start_line": start_line,
                "end_line": line_num
            })
            
            # Backtrack to implement overlap
            overlap_lines = []
            overlap_len = 0
            for l in reversed(current_lines):
                # Stop if including another line exceeds the overlap and we have at least one line
                if overlap_len + len(l) > overlap and len(overlap_lines) > 0:
                    break
                overlap_lines.insert(0, l)
                overlap_len += len(l)
                
            current_lines = overlap_lines
            current_length = overlap_len
            start_line = line_num - len(current_lines) + 1
            
    # Add final chunk if there are remaining lines
    if current_lines:
        raw_code = "".join(current_lines)
        if len(raw_code.strip()) > 10:  # Avoid indexing tiny or empty trailing chunks
            chunks.append({
                "file_path": rel_path,
                "file_name": file_name,
                "raw_code_content": raw_code,
                "start_line": start_line,
                "end_line": len(lines)
            })
            
    return chunks
    