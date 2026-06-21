import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as crypto from 'crypto';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import {
  USERNAME_MAX_LEN,
  USERNAME_MIN_LEN,
  USERNAME_REGEX,
} from './username.constants';

export type UsernameAvailabilityResult = {
  /** Normalized candidate (lowercase, trimmed) when parseable */
  username: string;
  valid: boolean;
  available: boolean;
  reason?: string;
};

@Injectable()
export class UsernameService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  normalize(raw: string): string {
    return raw.trim().toLowerCase();
  }

  isValidFormat(normalized: string): boolean {
    return USERNAME_REGEX.test(normalized);
  }

  validateFormatOrThrow(normalized: string): void {
    if (normalized.length < USERNAME_MIN_LEN || normalized.length > USERNAME_MAX_LEN) {
      throw new Error(
        `Username must be between ${USERNAME_MIN_LEN} and ${USERNAME_MAX_LEN} characters`,
      );
    }
    if (!this.isValidFormat(normalized)) {
      throw new Error(
        'Username may only contain lowercase letters, digits, and underscores',
      );
    }
  }

  async isTaken(normalizedUsername: string): Promise<boolean> {
    const found = await this.userModel
      .findOne({ username: normalizedUsername })
      .select('_id')
      .lean()
      .exec();
    return Boolean(found);
  }

  async assertAvailableForSignup(rawUsername: string): Promise<string> {
    const normalized = this.normalize(rawUsername);
    try {
      this.validateFormatOrThrow(normalized);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Invalid username';
      throw new BadRequestException(message);
    }
    if (await this.isTaken(normalized)) {
      throw new ConflictException('Username is already taken');
    }
    return normalized;
  }

  /**
   * Public check for clients (sign-up UI). Does not throw.
   */
  async checkAvailabilityResponse(raw: string): Promise<UsernameAvailabilityResult> {
    const normalized = this.normalize(raw);
    if (!normalized) {
      return {
        username: '',
        valid: false,
        available: false,
        reason: 'Username is required',
      };
    }
    if (normalized.length < USERNAME_MIN_LEN || normalized.length > USERNAME_MAX_LEN) {
      return {
        username: normalized,
        valid: false,
        available: false,
        reason: `Username must be between ${USERNAME_MIN_LEN} and ${USERNAME_MAX_LEN} characters`,
      };
    }
    if (!this.isValidFormat(normalized)) {
      return {
        username: normalized,
        valid: false,
        available: false,
        reason: 'Use only lowercase letters, numbers, and underscores',
      };
    }
    const taken = await this.isTaken(normalized);
    return {
      username: normalized,
      valid: true,
      available: !taken,
      reason: taken ? 'This username is already taken' : undefined,
    };
  }

  /**
   * Builds a slug from the email local part and appends a short suffix until unique.
   */
  async generateUniqueFromEmail(email: string): Promise<string> {
    const local = (email.split('@')[0] ?? '').toLowerCase();
    let base = local.replace(/[^a-z0-9_]/g, '');
    if (!base) {
      base = 'user';
    }
    base = base.slice(0, 20);

    for (let attempt = 0; attempt < 50; attempt++) {
      const suffix = attempt === 0 ? '' : `_${crypto.randomBytes(2).toString('hex')}`;
      let candidate = `${base}${suffix}`.slice(0, USERNAME_MAX_LEN);
      if (candidate.length < USERNAME_MIN_LEN) {
        candidate = `${base}_${crypto.randomBytes(3).toString('hex')}`.slice(0, USERNAME_MAX_LEN);
      }
      if (!this.isValidFormat(candidate)) {
        base = `user_${crypto.randomBytes(3).toString('hex')}`.slice(0, 18);
        continue;
      }
      if (!(await this.isTaken(candidate))) {
        return candidate;
      }
    }

    const emergency = `user_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    return emergency.slice(0, USERNAME_MAX_LEN);
  }
}
