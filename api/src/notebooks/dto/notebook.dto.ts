import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class CreateNotebookDto {
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(80)
  name: string;

  /** A top-level notebook to nest this one under. */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class UpdateNotebookDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'name cannot be empty' })
  @MaxLength(80)
  name?: string;

  /** null moves the notebook to the top level. */
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  parentId?: string | null;
}
