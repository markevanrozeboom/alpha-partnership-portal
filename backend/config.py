"""Application configuration loaded from environment variables."""

import os
from dotenv import load_dotenv

load_dotenv()

# API Keys
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY", "")

# LLM Settings
PRIMARY_MODEL = "claude-sonnet-4-20250514"
FALLBACK_MODEL = "gpt-4o"

# Perplexity Settings
PERPLEXITY_MODEL = "sonar-deep-research"
PERPLEXITY_BASE_URL = "https://api.perplexity.ai"

# World Bank API
WORLD_BANK_BASE_URL = "https://api.worldbank.org/v2"

# Output directory
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)
