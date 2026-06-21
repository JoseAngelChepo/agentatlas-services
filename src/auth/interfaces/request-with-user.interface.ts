import { Request } from 'express';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

export interface RequestWithUser extends Request {
  user: JwtPayload;
}
