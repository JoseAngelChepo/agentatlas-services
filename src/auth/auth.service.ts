import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { SignOptions } from 'jsonwebtoken';
import { UsersService } from '../users/users.service';
import { UsernameService } from '../users/username.service';
import { SessionsService } from '../sessions/sessions.service';
import { SessionType } from '../sessions/schemas/session.schema';
import { AuthProvider, UserDocument, AccountTier } from '../users/schemas/user.schema';
import { buildUserProfile } from '../users/utils/user-profile';
import { OutboundEmailService } from '../emails/services/outbound-email.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { AuthResponse } from './interfaces/auth-response.interface';
import {
  escapeHtmlForEmail,
  renderEmailLinkFallback,
  renderEmailParagraph,
  renderEmailPrimaryButton,
  renderTransactionalEmailLayout,
} from '../emails/templates/transactional-email-layout';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly usernameService: UsernameService,
    private readonly sessionsService: SessionsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly outboundEmailService: OutboundEmailService,
  ) {}

  private buildAuthUser(user: UserDocument): AuthResponse['user'] {
    return buildUserProfile(user);
  }

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    try {
      const username = await this.usernameService.assertAvailableForSignup(registerDto.username);
      const user = await this.usersService.create({
        email: registerDto.email.toLowerCase().trim(),
        username,
        password: registerDto.password,
        firstName: registerDto.firstName.trim(),
        lastName: registerDto.lastName.trim(),
        authProvider: AuthProvider.LOCAL,
      });

      const tokens = await this.generateTokens(user);
      await this.sessionsService.create(user.id, tokens.refresh_token, SessionType.BROWSER);
      return {
        ...tokens,
        user: this.buildAuthUser(user),
      };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof BadRequestException) throw error;
      throw new ConflictException('Registration failed');
    }
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const userDocument = await this.usersService.findByEmail(loginDto.email);
    if (
      !userDocument ||
      !(await this.usersService.validatePassword(userDocument, loginDto.password))
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.usersService.updateLastLogin(userDocument.id);

    const tokens = await this.generateTokens(userDocument);
    await this.sessionsService.create(userDocument.id, tokens.refresh_token, SessionType.BROWSER);
    return {
      ...tokens,
      user: this.buildAuthUser(userDocument),
    };
  }

  async googleLogin(user: Record<string, unknown>): Promise<AuthResponse> {
    const googleId = String(user.googleId ?? '');
    const email = String(user.email ?? '').toLowerCase().trim();
    const firstName = String(user.firstName ?? '').trim();
    const lastName = String(user.lastName ?? '').trim();
    const avatar = user.avatar ? String(user.avatar) : undefined;

    if (!googleId || !email) {
      throw new UnauthorizedException('Google profile is missing required fields');
    }

    let existingUser = await this.usersService.findByGoogleId(googleId);

    if (existingUser && !existingUser.username) {
      const generatedUsername = await this.usernameService.generateUniqueFromEmail(email);
      existingUser = await this.usersService.update(existingUser.id, {
        username: generatedUsername,
      });
    }

    if (!existingUser) {
      const sameEmailUser = await this.usersService.findByEmail(email);
      if (sameEmailUser) {
        const patch: {
          googleId: string;
          authProvider: AuthProvider;
          avatar?: string;
          isEmailVerified: boolean;
          username?: string;
        } = {
          googleId,
          authProvider: AuthProvider.GOOGLE,
          avatar,
          isEmailVerified: true,
        };
        if (!sameEmailUser.username) {
          patch.username = await this.usernameService.generateUniqueFromEmail(email);
        }
        existingUser = await this.usersService.update(sameEmailUser.id, patch);
      } else {
        const username = await this.usernameService.generateUniqueFromEmail(email);
        existingUser = await this.usersService.create({
          email,
          username,
          firstName: firstName || 'Google',
          lastName: lastName || 'User',
          googleId,
          avatar,
          authProvider: AuthProvider.GOOGLE,
          isEmailVerified: true,
        });
      }
    }

    await this.usersService.updateLastLogin(existingUser.id);
    const tokens = await this.generateTokens(existingUser);
    await this.sessionsService.create(existingUser.id, tokens.refresh_token, SessionType.BROWSER);
    return {
      ...tokens,
      user: this.buildAuthUser(existingUser),
    };
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto): Promise<AuthResponse> {
    try {
      this.jwtService.verify(refreshTokenDto.refresh_token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });

      const session = await this.sessionsService.findByRefreshToken(
        refreshTokenDto.refresh_token,
      );
      if (!session) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const userId = String(session.userId);
      const user = await this.usersService.findActiveById(userId);
      if (!user || !user.isActive) {
        await this.sessionsService.deleteByRefreshToken(refreshTokenDto.refresh_token);
        throw new UnauthorizedException('Invalid refresh token');
      }

      const tokens = await this.generateTokens(user);
      await this.sessionsService.updateRefreshToken(session.id, tokens.refresh_token);

      return {
        ...tokens,
        user: this.buildAuthUser(user),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(_userId: string, refreshToken: string): Promise<void> {
    await this.sessionsService.deleteByRefreshToken(refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessionsService.deleteAllByUserId(userId);
  }

  async getMe(userId: string): Promise<AuthResponse['user']> {
    const user = await this.usersService.findOne(userId);
    return this.buildAuthUser(user);
  }

  async requestPasswordReset(
    requestPasswordResetDto: RequestPasswordResetDto,
  ): Promise<{ message: string }> {
    const email = requestPasswordResetDto.email.toLowerCase().trim();
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      return {
        message: 'If an account with that email exists, a password reset link has been sent.',
      };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1);

    await this.usersService.setPasswordResetToken(email, resetToken, resetExpires);

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    const { html: emailHtml, text: emailText } = this.buildPasswordResetRequestEmail({
      firstName: user.firstName ?? 'there',
      resetUrl,
    });

    await this.outboundEmailService.sendHtmlEmail(
      user.email,
      'Reset your password',
      emailHtml,
      emailText,
    );

    return {
      message: 'If an account with that email exists, a password reset link has been sent.',
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const user = await this.usersService.findByPasswordResetToken(resetPasswordDto.token);

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    await this.usersService.updatePassword(user.id, resetPasswordDto.password);

    const { html: emailHtml, text: emailText } = this.buildPasswordResetConfirmationEmail({
      firstName: user.firstName ?? 'there',
    });

    await this.outboundEmailService.sendHtmlEmail(
      user.email,
      'Your password was updated',
      emailHtml,
      emailText,
    );

    return { message: 'Password has been reset successfully' };
  }

  private buildPasswordResetRequestEmail(params: {
    firstName: string;
    resetUrl: string;
  }): { html: string; text: string } {
    const safeName = escapeHtmlForEmail(params.firstName);

    const innerHtml = [
      renderEmailParagraph(`Hello ${safeName},`),
      renderEmailParagraph(
        'We received a request to reset your account password. Use the button below to choose a new password. This link expires in one hour.',
      ),
      renderEmailParagraph('If you did not request this, you can ignore this email.'),
    ].join('\n');

    const ctaHtml = [
      renderEmailPrimaryButton('Set a new password', params.resetUrl),
      renderEmailLinkFallback(params.resetUrl),
    ].join('\n');

    const html = renderTransactionalEmailLayout({
      eyebrow: 'Account security',
      title: 'Reset your password',
      innerHtml,
      ctaHtml,
      footerRightLabel: 'Account security',
    });

    const text = [
      'Reset your password',
      '',
      `Hello ${params.firstName},`,
      '',
      'We received a request to reset your account password. Use the link below to choose a new password. This link expires in one hour.',
      '',
      params.resetUrl,
      '',
      'If you did not request this, you can ignore this email.',
    ].join('\n');

    return { html, text };
  }

  private buildPasswordResetConfirmationEmail(params: { firstName: string }): {
    html: string;
    text: string;
  } {
    const safeName = escapeHtmlForEmail(params.firstName);

    const innerHtml = [
      renderEmailParagraph(`Hello ${safeName},`),
      renderEmailParagraph(
        'Your password has been successfully changed. You can sign in with your new password anytime.',
      ),
      renderEmailParagraph(
        'If you did not make this change, please contact support immediately.',
      ),
    ].join('\n');

    const html = renderTransactionalEmailLayout({
      eyebrow: 'Account security',
      title: 'Your password was updated',
      innerHtml,
      ctaHtml: '',
      footerRightLabel: 'Account security',
    });

    const text = [
      'Your password was updated',
      '',
      `Hello ${params.firstName},`,
      '',
      'Your password has been successfully changed. You can sign in with your new password anytime.',
      '',
      'If you did not make this change, please contact support immediately.',
    ].join('\n');

    return { html, text };
  }

  private async generateTokens(
    user: UserDocument,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      accountTier: user.accountTier ?? AccountTier.FREE,
    };

    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '7d') as SignOptions['expiresIn'],
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
          '30d',
        ) as SignOptions['expiresIn'],
      }),
    ]);

    return { access_token, refresh_token };
  }
}
