import { Module, forwardRef } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module';
import { InferenceSetupController } from './inference-setup.controller';
import { InferenceProviderService } from './inference-provider.service';
import { GeminiInferenceService } from './gemini/gemini-inference.service';
import { GrokResponsesInferenceService } from './grok/grok-responses-inference.service';
import { OpenAiResponsesInferenceService } from './openai/openai-responses-inference.service';
import { OpenAiStructuredOutputService } from './openai/openai-structured-output.service';

@Module({
  imports: [forwardRef(() => ToolsModule)],
  controllers: [InferenceSetupController],
  providers: [
    InferenceProviderService,
    OpenAiStructuredOutputService,
    OpenAiResponsesInferenceService,
    GrokResponsesInferenceService,
    GeminiInferenceService,
  ],
  exports: [
    InferenceProviderService,
    OpenAiStructuredOutputService,
    OpenAiResponsesInferenceService,
    GrokResponsesInferenceService,
    GeminiInferenceService,
  ],
})
export class InferenceModule {}
