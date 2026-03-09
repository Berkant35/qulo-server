import type { Request, Response, NextFunction } from "express";
import { userService } from "../services/user.service.js";
import { badgeService } from "../services/badge.service.js";
import type {
  UpdateProfileInput,
  UpdateDetailsInput,
  UpdateLocationInput,
  UpdatePushTokenInput,
} from "../validators/user.validator.js";
import { AppError } from "../utils/errors.js";

export async function getMeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await userService.getMe(req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = req.body as UpdateProfileInput;
    const result = await userService.updateProfile(req.user!.userId, data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateDetailsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = req.body as UpdateDetailsInput;
    const result = await userService.updateDetails(req.user!.userId, data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateLocationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { lat, lng, city } = req.body as UpdateLocationInput;
    await userService.updateLocation(req.user!.userId, lat, lng, city);
    res.json({ message: "Location updated" });
  } catch (err) {
    next(err);
  }
}

export async function updatePushTokenHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { push_token } = req.body as UpdatePushTokenInput;
    await userService.updatePushToken(req.user!.userId, push_token);
    res.json({ message: "Push token updated" });
  } catch (err) {
    next(err);
  }
}

export async function uploadPhotoHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      throw new AppError("NO_FILE", 400, "No file provided");
    }

    const result = await userService.uploadPhoto(
      req.user!.userId,
      req.file.buffer,
      req.file.mimetype,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function deletePhotoHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const index = parseInt(req.params.index as string, 10);
    if (isNaN(index)) {
      throw new AppError("INVALID_PHOTO_INDEX", 400, "Invalid photo index");
    }
    const result = await userService.deletePhoto(req.user!.userId, index);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function boostHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await userService.boost(req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function claimBadgeRewardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { level } = req.body;
    const result = await badgeService.claimReward(userId, level);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function deleteAccountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await userService.deleteAccount(req.user!.userId);
    res.json({ message: "Account deleted" });
  } catch (err) {
    next(err);
  }
}
