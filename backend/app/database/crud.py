from sqlalchemy import and_
from sqlalchemy.orm import Session

from .models import Log, Request
from server.schemas import LogSchema, RequestSchema

# region Log CRUD


def get_logs(db: Session, skip: int = 0):
    return db.query(Log).offset(skip).all()


def get_log_by_id(db: Session, log_id: int):
    return db.query(Log).filter(Log.id == log_id).first()


def create_log(db: Session, log: LogSchema):
    _log = Log(username=log.username, interaction=log.interaction,
               prompt=log.prompt, ui_id=log.ui_id)
    db.add(_log)
    db.commit()
    db.refresh(_log)

    return _log


def remove_log(db: Session, log_id: int):
    _log = get_log_by_id(db=db, log_id=log_id)

    db.delete(_log)
    db.commit()

# endregion

# region Request CRUD


def get_requests(db: Session, skip: int = 0):
    return db.query(Request).offset(skip).all()


def get_request_by_id(db: Session, request_id: int):
    return db.query(Request).filter(Request.id == request_id).first()


def get_request_by_prompt_and_text(db: Session, prompt: str, text: str):
    return db.query(Request).filter(
        and_(Request.prompt == prompt, Request.text == text, Request.success)
    ).first()


def create_request(db: Session, request: RequestSchema):
    _req = Request(
        username=request.username,
        prompt=request.prompt,
        text=request.text,
        response=request.response,
        success=request.success
    )

    db.add(_req)
    db.commit()
    db.refresh(_req)

    return _req

# endregion
