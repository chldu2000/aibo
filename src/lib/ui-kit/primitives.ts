/** Active primitive implementation selected by the UI kit registry. */
import { activeUiKit } from './registry';

export const uiKit = activeUiKit;
export const AlertDialog = uiKit.AlertDialog;
export const Badge = uiKit.Badge;
export const Button = uiKit.Button;
export const Card = uiKit.Card;
export const CardContent = uiKit.CardContent;
export const CardFooter = uiKit.CardFooter;
export const CardHeader = uiKit.CardHeader;
export const CardTitle = uiKit.CardTitle;
export const Input = uiKit.Input;
export const Label = uiKit.Label;
export const Separator = uiKit.Separator;
export const Textarea = uiKit.Textarea;
