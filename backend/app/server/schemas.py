from typing import List, Dict, Optional
from pydantic import BaseModel


class LogSchema(BaseModel):
    username: str
    interaction: str  # 'chat', 'reflection', 'click', 'page_change'

    prompt: Optional[str] = None
    ui_id: Optional[str] = None


class RequestSchema(BaseModel):
    username: str
    prompt: str
    text: str
    response: str
    success: bool


class ReflectionRequest(BaseModel):
    username: str
    text: str
    prompt: str


class ReflectionResponseItem(BaseModel):
    reflection: str


class ReflectionResponses(BaseModel):
    reflections: List[ReflectionResponseItem]


class ChatRequest(BaseModel):
    messages: List[Dict[str, str]]
    username: str
