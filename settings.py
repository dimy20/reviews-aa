"""All settings in one place: secrets from .env, infra from infra.yaml.

    from settings import get_settings
    settings = get_settings()
    settings.runpod_api_key
    settings.infra.devices
"""
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent


class InfraSettings(BaseModel):
    """infra.yaml: the RunPod pod that serves Kev."""
    image: str
    network_volume_id: str
    data_center: str
    port: int
    devices: list[str]  # GPUs to try, in order of preference
    max_attempts: int
    wait_interval: int  # seconds between attempts


class Settings(BaseSettings):
    # Read from .env (or the real environment, which wins). Names are case-insensitive:
    # runpod_api_key <- RUNPOD_API_KEY.
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    runpod_api_key: str = ""
    kev_api_key: str = ""  # the key kev asks for (Authorization: Bearer ...)
    openrouter_api_key: str = ""
    hf_token: str = ""
    infra_config_path: Path = ROOT / "infra.yaml"

    @property
    def infra(self) -> InfraSettings:
        return _load_infra(self.infra_config_path)


@lru_cache
def _load_infra(path: Path) -> InfraSettings:
    with open(path, encoding="utf-8") as f:
        return InfraSettings(**yaml.safe_load(f))


@lru_cache
def get_settings() -> Settings:
    """Loaded once, then the same object every call."""
    return Settings()
