import { Module } from '@nestjs/common';
import { OutboundEmailService } from './services/outbound-email.service';
import { ResendService } from './services/resend.service';

@Module({
  providers: [ResendService, OutboundEmailService],
  exports: [ResendService, OutboundEmailService],
})
export class EmailsModule {}
