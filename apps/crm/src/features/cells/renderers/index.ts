/** Column type → renderer (display, editor, interaction behavior). */
import type { RendererMap } from '../cell-context';
import {
  creationLogRenderer,
  formulaRenderer,
  itemIdRenderer,
  lastUpdatedRenderer,
  mirrorRenderer,
  progressRenderer,
} from './computed';
import { connectRenderer } from './connect';
import { countryRenderer, emailRenderer, linkRenderer, phoneRenderer } from './contact';
import { locationRenderer } from './location';
import { dateRenderer, timelineRenderer } from './dates';
import { filesRenderer } from './files';
import { dropdownRenderer, statusRenderer } from './labels';
import { currencyRenderer, numberRenderer } from './numeric';
import { peopleRenderer } from './people';
import { tagsRenderer } from './tags';
import { longTextRenderer, nameRenderer, textRenderer } from './text';
import { buttonRenderer, checkboxRenderer, ratingRenderer } from './toggles';

export const RENDERERS: RendererMap = {
  name: nameRenderer,
  text: textRenderer,
  long_text: longTextRenderer,
  status: statusRenderer,
  people: peopleRenderer,
  date: dateRenderer,
  timeline: timelineRenderer,
  number: numberRenderer,
  currency: currencyRenderer,
  email: emailRenderer,
  phone: phoneRenderer,
  link: linkRenderer,
  dropdown: dropdownRenderer,
  tags: tagsRenderer,
  checkbox: checkboxRenderer,
  rating: ratingRenderer,
  progress: progressRenderer,
  files: filesRenderer,
  connect_boards: connectRenderer,
  mirror: mirrorRenderer,
  formula: formulaRenderer,
  location: locationRenderer,
  country: countryRenderer,
  last_updated: lastUpdatedRenderer,
  creation_log: creationLogRenderer,
  item_id: itemIdRenderer,
  button: buttonRenderer,
};
