import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, ValidateNested } from 'class-validator';
import { SwarmGraphEdgeDto } from './swarm-graph-edge.dto';
import { SwarmGraphNodeDto } from './swarm-graph-node.dto';

export class UpsertSwarmGraphDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SwarmGraphNodeDto)
  nodes: SwarmGraphNodeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SwarmGraphEdgeDto)
  edges: SwarmGraphEdgeDto[];

  /** Worker id or graph node id (e.g. `end-<timestamp>`) when the flow has no agents. */
  @IsString()
  entryNode: string;

  @IsString()
  exitNode: string;
}
