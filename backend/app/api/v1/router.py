from fastapi import APIRouter
from app.api.v1.health import router as health_router
from app.api.v1.auth import router as auth_router
from app.api.v1.sources import router as sources_router
from app.api.v1.conversations import router as conversations_router
from app.api.v1.courses import router as courses_router
from app.api.v1.notes import router as notes_router
from app.api.v1.quizzes import router as quizzes_router
from app.api.v1.flashcards import router as flashcards_router

api_router = APIRouter(prefix="/v1")

# Đăng ký các router thành phần của Lumi v1
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(sources_router)
api_router.include_router(conversations_router)
api_router.include_router(courses_router)
api_router.include_router(notes_router)
api_router.include_router(quizzes_router)
api_router.include_router(flashcards_router, prefix="/flashcards", tags=["flashcards"])
