import type { Request, Response } from "express";
import { userService } from "../services/user.service.js";
import { MAX_PROFILE_PHOTOS } from "../constants/photos.js";
import { AppError } from "../utils/errors.js";
import { isUuid } from "../utils/validation.js";
import { flashMessage, formList } from "./admin-form.js";

/** Beklenen servis hataları → kullanıcı detayındaki `?error=` kodu (mesajlar admin.controller'da). */
const FLASH_BY_ERROR_CODE: Record<string, string> = {
  PHOTO_NOT_FOUND: "photo_not_found",
  PHOTOS_CHANGED: "photos_changed",
  USER_NOT_FOUND: "user_not_found",
};

/** Kullanıcı detayından uygunsuz/hatalı fotoğrafları doğrudan profilden kaldırma. */
class UserPhotosAdminController {
  // Express 4: reddedilen promise errorHandler'a ulaşmaz (istek askıda kalır) — her dal yönlendirir.
  async remove(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    if (!isUuid(id)) {
      res.status(400).render("error", { message: "Invalid user id", session: req.session });
      return;
    }
    const urls = [...new Set(formList(req.body?.urls).filter(Boolean))];
    if (urls.length === 0 || urls.length > MAX_PROFILE_PHOTOS) {
      res.redirect(`/admin/users/${id}?error=photo_selection`);
      return;
    }
    try {
      const { removed } = await userService.removePhotosByUrl(id, urls);
      console.log(`[ADMIN] photos removed: user=${id} count=${removed.length} by=${req.session.adminEmail}`, removed);
    } catch (err) {
      const flash = err instanceof AppError ? flashMessage(FLASH_BY_ERROR_CODE, err.code) : null;
      if (!flash) console.error("[admin] remove photos failed:", { userId: id, err });
      res.redirect(`/admin/users/${id}?error=${flash ?? "action_failed"}`);
      return;
    }
    res.redirect(`/admin/users/${id}`);
  }
}

export const userPhotosAdminController = new UserPhotosAdminController();
