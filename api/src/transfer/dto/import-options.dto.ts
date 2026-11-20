import { IsBoolean } from 'class-validator';
import { IfPresent, ToBoolean } from '../../common/transforms';

/** The form fields that go with the files of an import. */
export class ImportOptionsDto {
  /**
   * Leave out notes whose title, notebook and text the account already has,
   * so that importing the same file twice does not make every note twice.
   * On unless `false` is sent.
   */
  @IfPresent()
  @ToBoolean()
  @IsBoolean()
  skipExisting?: boolean;
}
