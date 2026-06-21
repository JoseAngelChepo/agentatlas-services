import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const id = this.configService.get<string>('GOOGLE_CLIENT_ID')?.trim();
    const secret = this.configService.get<string>('GOOGLE_CLIENT_SECRET')?.trim();
    if (!id || !secret) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const raw = request.query?.state;
    const state = Array.isArray(raw) ? raw[0] : raw;
    if (typeof state === 'string' && state.length > 0) {
      return { state };
    }
    return {};
  }
}
