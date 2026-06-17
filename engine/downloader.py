import os
import re
import zipfile
import requests
import logging
from typing import Optional

logger = logging.getLogger(__name__)

def parse_github_url(url: str):
    """
    Parses a GitHub URL to extract the owner and repository name.
    Supported formats:
    - https://github.com/owner/repo
    - https://github.com/owner/repo.git
    - http://github.com/owner/repo/tree/branch
    """
    url = url.strip().rstrip('/') #removes spaces and /
    if url.endswith('.git'):
        url = url[:-4] #take everything except last 4 chars(removes .git)
    
    match = re.search(r'github\.com/([^/]+)/([^/]+)', url)
    if not match:
        raise ValueError(f"Invalid GitHub URL: {url}")
    
    owner = match.group(1)
    repo = match.group(2)
    
    # If the URL contains sub-paths like '/tree/branch', extract just the repo name
    if '/tree/' in repo:
        repo = repo.split('/tree/')[0]
    
    return owner, repo

# download_path → where ZIP file will be saved
# token → optional GitHub access token
def download_github_zip(owner: str, repo: str, download_path: str, token: Optional[str] = None):
    """
    Downloads the repository zipball from GitHub to download_path.
    """
    url = f"https://api.github.com/repos/{owner}/{repo}/zipball" #Visiting this URL downloads the repository as a ZIP.
    #Creating HTTP headers. Headers tell that we want json compatible responses
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
    }
    if token:#Tokens are used for private repositories and also to avoid rate limiting
        headers["Authorization"] = f"Bearer {token}"
        
    logger.info(f"Downloading zipball from {url}")#Writes log message.
    response = requests.get(url, headers=headers, stream=True)
    
    if response.status_code != 200:
        raise Exception(f"Failed to download repository. Status code: {response.status_code}. Response: {response.text}")
        
    # Ensure directory exists
    os.makedirs(os.path.dirname(download_path), exist_ok=True)
    
    # Stream download to avoid high memory consumption
    with open(download_path, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
    logger.info(f"Successfully downloaded zipball to {download_path}")



def extract_zip(zip_path: str, extract_to: str):
    """
    Extracts zip archive and returns the path to the root directory of the extracted codebase.
    GitHub zipballs have a top-level directory (e.g., owner-repo-sha).
    """
    logger.info(f"Extracting {zip_path} to {extract_to}")
    os.makedirs(extract_to, exist_ok=True)
    
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_to)
        
    # Find the top-level directory created inside extract_to
    contents = os.listdir(extract_to)
    if len(contents) == 1 and os.path.isdir(os.path.join(extract_to, contents[0])):
        extracted_root = os.path.join(extract_to, contents[0])
        logger.info(f"Extracted codebase root: {extracted_root}")
        return extracted_root
        
    logger.info(f"Extracted codebase root: {extract_to}")
    return extract_to
    