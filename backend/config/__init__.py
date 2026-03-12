"""Application configuration loaded from environment variables.

This package also contains YAML business rules in config/rules/.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# API Keys
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY", "")
GAMMA_API_KEY = os.getenv("GAMMA_API_KEY", "sk-gamma-6lM93deZBMh1KkbK5HG0aVKiFm4X477v1bjxxyvdBQ")

# LLM Settings
PRIMARY_MODEL = "claude-sonnet-4-20250514"
FALLBACK_MODEL = "gpt-4o"

# Perplexity Settings
PERPLEXITY_MODEL = "sonar-deep-research"
PERPLEXITY_BASE_URL = "https://api.perplexity.ai"

# World Bank API
WORLD_BANK_BASE_URL = "https://api.worldbank.org/v2"

# Output directory — relative to the *backend* directory (one level up from this package)
OUTPUT_DIR = os.path.join(Path(__file__).resolve().parent.parent, "outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)
