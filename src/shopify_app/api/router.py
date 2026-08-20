from fastapi import APIRouter

from shopify_app.api.health import router as health_router
from shopify_app.api.shopify import router as shopify_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(shopify_router, prefix="/api/v1")
