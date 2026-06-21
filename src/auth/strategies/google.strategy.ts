import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

type GoogleOAuthProfile = {
  id: string;
  name?: { givenName?: string; familyName?: string };
  emails?: Array<{ value?: string }>;
  photos?: Array<{ value?: string }>;
};

/** Passport rejects empty clientID; use only until real Google OAuth env is set. */
const GOOGLE_OAUTH_DISABLED_PLACEHOLDER = '__google_oauth_not_configured__';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly configService: ConfigService) {
    const clientID =
      configService.get<string>('GOOGLE_CLIENT_ID')?.trim() || GOOGLE_OAUTH_DISABLED_PLACEHOLDER;
    const clientSecret =
      configService.get<string>('GOOGLE_CLIENT_SECRET')?.trim() ||
      GOOGLE_OAUTH_DISABLED_PLACEHOLDER;
    const callbackURL =
      configService.get<string>('GOOGLE_CALLBACK_URL')?.trim() ||
      'http://localhost:3001/api/v1/auth/google/callback';

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    });

    if (
      clientID === GOOGLE_OAUTH_DISABLED_PLACEHOLDER ||
      clientSecret === GOOGLE_OAUTH_DISABLED_PLACEHOLDER
    ) {
      new Logger(GoogleStrategy.name).warn(
        'Google OAuth is disabled: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL to enable it.',
      );
    }
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: GoogleOAuthProfile,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Google account email is required'), false);
      return;
    }

    done(null, {
      googleId: profile.id,
      email,
      firstName: profile.name?.givenName ?? '',
      lastName: profile.name?.familyName ?? '',
      avatar: profile.photos?.[0]?.value,
    });
  }
}
