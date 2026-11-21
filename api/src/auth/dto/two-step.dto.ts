import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StartTwoStepDto {
  @IsString()
  @IsNotEmpty({ message: 'currentPassword is required' })
  currentPassword: string;
}

export class EnableTwoStepDto {
  /** The first code the app shows for the new secret. */
  @IsString()
  @IsNotEmpty({ message: 'code is required' })
  @MaxLength(40)
  code: string;
}

/** Turning codes off and new recovery codes take both. */
export class ConfirmTwoStepDto {
  @IsString()
  @IsNotEmpty({ message: 'currentPassword is required' })
  currentPassword: string;

  /** From the app, or a recovery code. */
  @IsString()
  @IsNotEmpty({ message: 'code is required' })
  @MaxLength(40)
  code: string;
}
