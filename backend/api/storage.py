"""
Storage helper for shop photos.

Currently saves to local disk (backend/media/shop_photos/).
To swap to Supabase Storage or Cloudinary later, replace the body of
`upload_photo` with the respective API call. The rest of the app
won't need to change.
"""

import os
import uuid
from django.conf import settings
from django.core.files.storage import default_storage


def upload_photo(uploaded_file, shop_id_hint=None):
    """
    Save an uploaded photo and return its public URL.

    Args:
        uploaded_file: A Django UploadedFile (from request.FILES)
        shop_id_hint: Optional UUID/int for the filename prefix.

    Returns:
        A URL string like '/media/shop_photos/abc123.jpg'
    """
    if not uploaded_file:
        return None

    ext = os.path.splitext(uploaded_file.name)[1].lower() or '.jpg'
    filename = f"{uuid.uuid4().hex}{ext}"
    rel_path = os.path.join('shop_photos', filename)

    # Save to disk via Django's storage API (works for local, S3, etc.)
    saved_path = default_storage.save(rel_path, uploaded_file)

    # Build the URL that the browser can use
    return f"{settings.MEDIA_URL}{saved_path}"