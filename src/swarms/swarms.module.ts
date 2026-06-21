import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InferenceModule } from '../inference/inference.module';
import { UsersModule } from '../users/users.module';
import { UserApiTokensModule } from '../user-api-tokens/user-api-tokens.module';
import { ScraperModule } from '../scraper/scraper.module';
import { ToolsModule } from '../tools/tools.module';
import { AgentRun, AgentRunSchema } from './schemas/agent-run.schema';
import { AgentWorker, AgentWorkerSchema } from './schemas/agent-worker.schema';
import { SwarmGraph, SwarmGraphSchema } from './schemas/swarm-graph.schema';
import { SwarmRun, SwarmRunSchema } from './schemas/swarm-run.schema';
import { SwarmRunApproval, SwarmRunApprovalSchema } from './schemas/swarm-run-approval.schema';
import { Swarm, SwarmSchema } from './schemas/swarm.schema';
import { AGENT_WORKER_EXECUTOR } from './orchestrator/worker-executor.interface';
import { LlmWorkerExecutorService } from './orchestrator/llm-worker-executor.service';
import { RoutingWorkerExecutorService } from './orchestrator/routing-worker-executor.service';
import { StubWorkerExecutorService } from './orchestrator/stub-worker-executor.service';
import { SwarmOrchestratorService } from './orchestrator/swarm-orchestrator.service';
import { AgentRunsService } from './services/agent-runs.service';
import { AgentWorkersService } from './services/agent-workers.service';
import { SwarmDuplicationService } from './services/swarm-duplication.service';
import { SwarmGraphsService } from './services/swarm-graphs.service';
import { SwarmRunsService } from './services/swarm-runs.service';
import { SwarmAccessService } from './services/swarm-access.service';
import { SwarmsService } from './services/swarms.service';
import { AdminAgentWorkersController } from './controllers/admin-agent-workers.controller';
import { AdminSwarmRunsController } from './controllers/admin-swarm-runs.controller';
import { AdminSwarmsController } from './controllers/admin-swarms.controller';
import { AgentWorkersController } from './controllers/agent-workers.controller';
import { SwarmRunApprovalsController } from './controllers/swarm-run-approvals.controller';
import { SwarmRunsController } from './controllers/swarm-runs.controller';
import { SwarmsController } from './controllers/swarms.controller';
import { SwarmRunApprovalsService } from './services/swarm-run-approvals.service';
import { SwarmRunInputEnrichmentService } from './services/swarm-run-input-enrichment.service';
import { SwarmAsToolService } from './services/swarm-as-tool.service';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    UserApiTokensModule,
    forwardRef(() => InferenceModule),
    ScraperModule,
    forwardRef(() => ToolsModule),
    MongooseModule.forFeature([
      { name: AgentWorker.name, schema: AgentWorkerSchema },
      { name: AgentRun.name, schema: AgentRunSchema },
      { name: Swarm.name, schema: SwarmSchema },
      { name: SwarmRun.name, schema: SwarmRunSchema },
      { name: SwarmGraph.name, schema: SwarmGraphSchema },
      { name: SwarmRunApproval.name, schema: SwarmRunApprovalSchema },
    ]),
  ],
  controllers: [
    AgentWorkersController,
    SwarmsController,
    SwarmRunApprovalsController,
    SwarmRunsController,
    AdminSwarmsController,
    AdminSwarmRunsController,
    AdminAgentWorkersController,
  ],
  providers: [
    AgentWorkersService,
    AgentRunsService,
    SwarmsService,
    SwarmDuplicationService,
    SwarmGraphsService,
    SwarmRunsService,
    SwarmRunApprovalsService,
    SwarmAccessService,
    SwarmRunInputEnrichmentService,
    SwarmAsToolService,
    SwarmOrchestratorService,
    StubWorkerExecutorService,
    LlmWorkerExecutorService,
    RoutingWorkerExecutorService,
    {
      provide: AGENT_WORKER_EXECUTOR,
      useExisting: RoutingWorkerExecutorService,
    },
  ],
  exports: [
    AgentWorkersService,
    AgentRunsService,
    SwarmsService,
    SwarmGraphsService,
    SwarmRunsService,
    SwarmRunApprovalsService,
    SwarmOrchestratorService,
    SwarmAccessService,
    SwarmAsToolService,
  ],
})
export class SwarmsModule {}
