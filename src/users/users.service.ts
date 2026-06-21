import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole, AccountTier } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';

export type AdminUserView = {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  isEmailVerified: boolean;
  authProvider: string;
  avatar?: string;
  googleId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  lastLogin?: Date;
  accountTier: AccountTier;
  canCreateSwarms: boolean;
};

export type AdminUserListResult = {
  items: AdminUserView[];
  total: number;
  page: number;
  limit: number;
};

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async create(dto: CreateUserDto): Promise<UserDocument> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.userModel.findOne({ email }).exec();
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const username = dto.username.toLowerCase().trim();
    const usernameTaken = await this.userModel.findOne({ username }).select('_id').lean().exec();
    if (usernameTaken) {
      throw new ConflictException('Username is already taken');
    }

    const hashedPassword = dto.password ? await bcrypt.hash(dto.password, 12) : undefined;
    const user = new this.userModel({
      email,
      username,
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      authProvider: dto.authProvider,
      avatar: dto.avatar,
      googleId: dto.googleId,
      isEmailVerified: dto.isEmailVerified,
    });
    return user.save();
  }

  async findOne(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id).select('-password').exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  async findByGoogleId(googleId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ googleId }).exec();
  }

  async findActiveById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('-password').exec();
  }

  async assertCanCreateSwarms(userId: string): Promise<void> {
    const user = await this.userModel.findById(userId).select('canCreateSwarms').lean().exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.canCreateSwarms) {
      throw new ForbiddenException('Swarm creation is not enabled for your account');
    }
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    if (!user.password) return false;
    return bcrypt.compare(password, user.password);
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(id, { lastLogin: new Date() }).exec();
  }

  async setPasswordResetToken(
    email: string,
    token: string,
    expires: Date,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findOneAndUpdate(
        { email: email.toLowerCase().trim() },
        { passwordResetToken: token, passwordResetExpires: expires },
        { new: true },
      )
      .exec();
  }

  async findByPasswordResetToken(token: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({
        passwordResetToken: token,
        passwordResetExpires: { $gt: new Date() },
      })
      .exec();
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.userModel
      .findByIdAndUpdate(id, {
        $set: { password: hashedPassword },
        $unset: { passwordResetToken: '', passwordResetExpires: '' },
      })
      .exec();
  }

  async update(
    id: string,
    patch: Partial<{
      googleId: string;
      authProvider: string;
      avatar: string;
      isEmailVerified: boolean;
      firstName: string;
      lastName: string;
      username: string;
    }>,
  ): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(id, patch, { new: true })
      .exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private toAdminUserView(doc: UserDocument): AdminUserView {
    return {
      id: doc.id,
      email: doc.email,
      username: doc.username ?? '',
      firstName: doc.firstName,
      lastName: doc.lastName,
      role: doc.role,
      isActive: doc.isActive,
      isEmailVerified: doc.isEmailVerified,
      authProvider: doc.authProvider,
      avatar: doc.avatar ?? undefined,
      googleId: doc.googleId ?? undefined,
      createdAt: doc.get('createdAt') as Date | undefined,
      updatedAt: doc.get('updatedAt') as Date | undefined,
      lastLogin: doc.lastLogin ?? undefined,
      accountTier: doc.accountTier ?? AccountTier.FREE,
      canCreateSwarms: doc.canCreateSwarms ?? false,
    };
  }

  private async countActiveAdmins(): Promise<number> {
    return this.userModel
      .countDocuments({ role: UserRole.ADMIN, isActive: true })
      .exec();
  }

  async adminFindMany(query: AdminListUsersQueryDto): Promise<AdminUserListResult> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const search = typeof query.search === 'string' ? query.search.trim() : '';

    const filter: FilterQuery<UserDocument> = {};
    if (search.length > 0) {
      const rx = new RegExp(this.escapeRegex(search), 'i');
      filter.$or = [
        { email: rx },
        { username: rx },
        { firstName: rx },
        { lastName: rx },
      ];
    }

    const [docs, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('-password -passwordResetToken -passwordResetExpires')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    return {
      items: docs.map((u) => this.toAdminUserView(u)),
      total,
      page,
      limit,
    };
  }

  async adminFindOne(id: string): Promise<AdminUserView> {
    const user = await this.userModel.findById(id).select('-password').exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toAdminUserView(user);
  }

  async adminUpdate(
    id: string,
    dto: AdminUpdateUserDto,
    actingAdminId: string,
  ): Promise<AdminUserView> {
    const defined =
      dto.role !== undefined ||
      dto.isActive !== undefined ||
      dto.firstName !== undefined ||
      dto.lastName !== undefined ||
      dto.isEmailVerified !== undefined ||
      dto.accountTier !== undefined ||
      dto.canCreateSwarms !== undefined;
    if (!defined) {
      throw new BadRequestException('No supported fields to update');
    }

    const user = await this.userModel.findById(id).select('-password').exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isSelf = actingAdminId === id;

    if (isSelf) {
      if (dto.role === UserRole.USER && user.role === UserRole.ADMIN) {
        throw new BadRequestException('You cannot remove your own admin role');
      }
      if (dto.isActive === false) {
        throw new BadRequestException('You cannot deactivate your own account');
      }
    }

    const becomesNonAdmin =
      dto.role === UserRole.USER && user.role === UserRole.ADMIN;
    const becomesInactiveAdmin =
      dto.isActive === false && user.role === UserRole.ADMIN && user.isActive;

    if (becomesNonAdmin || becomesInactiveAdmin) {
      const admins = await this.countActiveAdmins();
      if (admins <= 1) {
        throw new BadRequestException('Cannot remove or deactivate the last active admin');
      }
    }

    const $set: Record<string, unknown> = {};

    if (dto.accountTier !== undefined) $set.accountTier = dto.accountTier;
    if (dto.role !== undefined) $set.role = dto.role;
    if (dto.isActive !== undefined) $set.isActive = dto.isActive;
    if (dto.firstName !== undefined) $set.firstName = dto.firstName;
    if (dto.lastName !== undefined) $set.lastName = dto.lastName;
    if (dto.isEmailVerified !== undefined) $set.isEmailVerified = dto.isEmailVerified;
    if (dto.canCreateSwarms !== undefined) $set.canCreateSwarms = dto.canCreateSwarms;

    const updated = await this.userModel
      .findByIdAndUpdate(id, { $set }, { new: true, runValidators: true })
      .select('-password -passwordResetToken -passwordResetExpires')
      .exec();

    if (!updated) {
      throw new NotFoundException('User not found');
    }

    return this.toAdminUserView(updated);
  }
}
