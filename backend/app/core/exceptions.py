import logging
from typing import Any, Optional
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

logger = logging.getLogger("studyflow.exceptions")

class StudyFlowException(Exception):
    def __init__(self, message: str, code: str = "INTERNAL_ERROR", status_code: int = 500, details: Optional[Any] = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details

class QuotaExceededException(StudyFlowException):
    def __init__(self, message: str = "Hạn mức AI của bạn đã hết cho chu kỳ này", details: Optional[Any] = None):
        super().__init__(message=message, code="QUOTA_EXCEEDED", status_code=status.HTTP_429_TOO_MANY_REQUESTS, details=details)

class ResourceNotFoundException(StudyFlowException):
    def __init__(self, resource: str, resource_id: Any):
        super().__init__(
            message=f"{resource} với mã {resource_id} không tồn tại hoặc bạn không có quyền truy cập",
            code="NOT_FOUND",
            status_code=status.HTTP_404_NOT_FOUND
        )

class PermissionDeniedException(StudyFlowException):
    def __init__(self, message: str = "Bạn không có quyền thực hiện thao tác này"):
        super().__init__(message=message, code="PERMISSION_DENIED", status_code=status.HTTP_403_FORBIDDEN)


async def studyflow_exception_handler(request: Request, exc: StudyFlowException) -> JSONResponse:
    logger.warning(f"Handled StudyFlowException: {exc.code} - {exc.message}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details
            }
        }
    )

async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    code = "HTTP_ERROR"
    message = str(detail)
    if isinstance(detail, str) and ":" in detail:
        parts = detail.split(":", 1)
        code = parts[0].strip()
        message = parts[1].strip()

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {
                "code": code,
                "message": message,
                "details": None
            }
        }
    )

async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "success": False,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Dữ liệu yêu cầu không hợp lệ",
                "details": errors
            }
        }
    )
