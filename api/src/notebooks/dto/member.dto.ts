import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, MaxLength } from 'class-validator';

export const MEMBER_ROLES = ['read', 'edit'] as const;

export class InviteDto {
  /** The address to invite. An account with it can accept in the app; otherwise through the link in the mail. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  /** `read` to read the notes, `edit` to change their text and tags and add notes too. */
  @IsIn(MEMBER_ROLES)
  role: (typeof MEMBER_ROLES)[number];
}

export class MemberRoleDto {
  @IsIn(MEMBER_ROLES)
  role: (typeof MEMBER_ROLES)[number];
}

export class AcceptInviteDto {
  /** The token from the link in the invitation mail. */
  @IsString()
  @MaxLength(100)
  token: string;
}
