import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { RequestWithUser } from './interfaces/request-with-user.interface';
import { UserApiTokensService } from '../user-api-tokens/user-api-tokens.service';
import { CreateUserApiTokenDto } from '../user-api-tokens/dto/create-user-api-token.dto';
import { UsernameService } from '../users/username.service';
import { UsernameAvailabilityQueryDto } from './dto/username-availability-query.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userApiTokensService: UserApiTokensService,
    private readonly usernameService: UsernameService,
  ) {}

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  /** Validate username format and whether it is still available (public; for sign-up UI). */
  @Get('username/availability')
  async usernameAvailability(@Query() query: UsernameAvailabilityQueryDto) {
    return this.usernameService.checkAvailabilityResponse(query.username ?? '');
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  async logout(@Req() req: RequestWithUser, @Body() body: RefreshTokenDto) {
    await this.authService.logout(req.user.sub, body.refresh_token);
    return { message: 'Logged out successfully' };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  async logoutAll(@Req() req: RequestWithUser) {
    await this.authService.logoutAll(req.user.sub);
    return { message: 'Logged out from all devices successfully' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  async getMe(@Req() req: RequestWithUser) {
    return this.authService.getMe(req.user.sub);
  }

  @Post('forgot-password')
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleAuth() {
    return;
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthRedirect(@Req() req: Request, @Res() res: Response) {
    const authResponse = await this.authService.googleLogin(req.user as Record<string, unknown>);

    const params = new URLSearchParams({
      token: authResponse.access_token,
      refresh: authResponse.refresh_token,
      role: authResponse.user.role,
      username: authResponse.user.username,
    });

    const rawState = req.query?.state;
    const state = Array.isArray(rawState) ? rawState[0] : rawState;
    if (typeof state === 'string' && state.length > 0) {
      params.set('state', state);
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/auth/google/callback?${params.toString()}`;

    return res.status(HttpStatus.FOUND).redirect(redirectUrl);
  }

  /** Create a per-user API token (for agents / automation). Raw token is returned once. JWT only. */
  @Post('api-tokens')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  async createApiToken(
    @Req() req: RequestWithUser,
    @Body() dto: CreateUserApiTokenDto,
  ) {
    return this.userApiTokensService.create(req.user.sub, dto);
  }

  @Get('api-tokens')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  async listApiTokens(@Req() req: RequestWithUser) {
    return this.userApiTokensService.listForUser(req.user.sub);
  }

  @Delete('api-tokens/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  async revokeApiToken(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.userApiTokensService.revoke(req.user.sub, id);
    return { message: 'Token revoked' };
  }
}
