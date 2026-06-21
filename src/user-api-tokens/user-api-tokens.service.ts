import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Model, Types } from 'mongoose';
import { UserApiToken, UserApiTokenDocument } from './schemas/user-api-token.schema';
import { UsersService } from '../users/users.service';
import { CreateUserApiTokenDto } from './dto/create-user-api-token.dto';
import { ConfigService } from '@nestjs/config';
import { UserRole, AccountTier } from '../users/schemas/user.schema';

export type ValidatedPatUser = {
  sub: string;
  email: string;
  role: UserRole;
  accountTier: AccountTier;
};

@Injectable()
export class UserApiTokensService {
  private readonly keyPrefix: string;

  constructor(
    @InjectModel(UserApiToken.name)
    private readonly tokenModel: Model<UserApiTokenDocument>,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {
    this.keyPrefix = this.config.get<string>('AGENT_KEY_PREFIX', 'tc_');
  }

  /**
   * Raw token format: {prefix}{24hexMongoId}_{64hexSecret}
   * Lookup by id, then bcrypt compare secret.
   */
  async create(
    userId: string,
    dto: CreateUserApiTokenDto,
  ): Promise<{ id: string; token: string; prefix: string; name: string; createdAt: Date }> {
    const secret = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(secret, 12);

    const tokenId = new Types.ObjectId();
    const rawToken = `${this.keyPrefix}${tokenId.toString()}_${secret}`;
    const prefix = rawToken.slice(0, Math.min(16, rawToken.length));

    const doc = await this.tokenModel.create({
      _id: tokenId,
      userId: new Types.ObjectId(userId),
      name: (dto.name ?? '').trim(),
      tokenHash,
      prefix,
      lastUsedAt: null,
    });

    return {
      id: doc.id,
      token: rawToken,
      prefix,
      name: doc.name,
      createdAt: (doc.toObject() as { createdAt?: Date }).createdAt ?? new Date(),
    };
  }

  async listForUser(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      prefix: string;
      lastUsedAt: Date | null;
      createdAt: Date;
    }>
  > {
    const rows = await this.tokenModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('-tokenHash')
      .sort({ createdAt: -1 })
      .lean();

    return rows.map((r) => {
      const row = r as typeof r & { createdAt?: Date };
      return {
        id: r._id.toString(),
        name: r.name,
        prefix: r.prefix,
        lastUsedAt: r.lastUsedAt ?? null,
        createdAt: row.createdAt ?? new Date(0),
      };
    });
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    const result = await this.tokenModel.deleteOne({
      _id: new Types.ObjectId(tokenId),
      userId: new Types.ObjectId(userId),
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Token not found');
    }
  }

  /**
   * Validates a user PAT string; updates lastUsedAt on success.
   */
  async validateRawToken(rawToken: string): Promise<ValidatedPatUser | null> {
    if (!rawToken.startsWith(this.keyPrefix)) {
      return null;
    }

    const rest = rawToken.slice(this.keyPrefix.length);
    const underscore = rest.indexOf('_');
    if (underscore <= 0) {
      return null;
    }

    const idPart = rest.slice(0, underscore);
    const secretPart = rest.slice(underscore + 1);

    if (!Types.ObjectId.isValid(idPart) || !/^[a-f0-9]+$/i.test(secretPart)) {
      return null;
    }

    const doc = await this.tokenModel.findById(idPart).select('+tokenHash').exec();
    if (!doc) {
      return null;
    }

    const ok = await bcrypt.compare(secretPart, doc.tokenHash);
    if (!ok) {
      return null;
    }

    await doc.updateOne({ $set: { lastUsedAt: new Date() } });

    const user = await this.usersService.findActiveById(doc.userId.toString());
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid API token');
    }

    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      accountTier: user.accountTier ?? AccountTier.FREE,
    };
  }
}
