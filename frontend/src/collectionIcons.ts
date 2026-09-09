import {
  Book, BookOpen, BookMarked, BookText, BookHeart, BookCheck,
  Library, Bookmark, Notebook, NotebookPen, ScrollText, FileText,
  Newspaper, GraduationCap, Pencil, PenTool, Feather, Highlighter,
  Glasses, Quote, Leaf, Trees, TreePine, TreePalm,
  Flower, Sprout, Sun, Moon, MoonStar, Cloud,
  Snowflake, Wind, Rainbow, WavesHorizontal, Mountain, Sunrise,
  Sunset, Star, Sparkles, Zap, Flame, Droplet,
  Globe, Umbrella, Compass, Map, MapPin, Anchor,
  Ship, Sailboat, Rocket, Plane, Car, Bike,
  TrainFront, Tent, Cat, Dog, Bird, Fish,
  Rabbit, Turtle, Bug, PawPrint, Coffee, Wine,
  Pizza, Cake, Apple, Cherry, Cookie, Utensils,
  IceCreamCone, Croissant, Laptop, Monitor, Smartphone, Headphones,
  Camera, Film, Clapperboard, Music, Guitar, Mic,
  Radio, Tv, Gamepad2, Podcast, Heart, Circle,
  Square, Triangle, Hexagon, Diamond, Crown, Award,
  Trophy, Medal, Gift, PartyPopper, Ghost, Skull,
  Swords, Shield, Key, Lock, Eye, Brain,
  Lightbulb, Puzzle, Target, Flag, Tag, Folder,
  FolderOpen, Archive, Box, Package, Briefcase, Backpack,
  Luggage, Inbox, Layers, ListChecks, Clock, CalendarDays,
  User, Users, House, Building2, Store, Castle,
  Church, School, Landmark, Hourglass, Palette, Brush,
  Scissors, Wand, WandSparkles, Atom, Microscope, Telescope,
  FlaskConical, Dna, Coins, Wallet, Gem, Dice5,
  type LucideIcon,
} from 'lucide-react'

// The icons a collection can wear, in the order the picker shows them. A
// curated 150 rather than lucide's full 1,715: named imports keep the bundle to
// what we actually offer, and a grid you can scan beats one you have to search.
//
// A collection stores the PascalCase name below, exactly as lucide exports it,
// so there is no slug-to-component translation to get wrong. Names are only
// ever looked up in this map — never rendered as markup — so an unknown one
// (an icon retired from a future lucide, a hand-edited row) resolves to null
// and the row falls back to the default dot.
const ICONS: Record<string, LucideIcon> = {
  // Reading
  Book, BookOpen, BookMarked, BookText, BookHeart, BookCheck,
  Library, Bookmark, Notebook, NotebookPen, ScrollText, FileText,
  Newspaper, GraduationCap, Pencil, PenTool, Feather, Highlighter,
  Glasses, Quote,
  // Nature and weather
  Leaf, Trees, TreePine, TreePalm, Flower, Sprout,
  Sun, Moon, MoonStar, Cloud, Snowflake, Wind,
  Rainbow, WavesHorizontal, Mountain, Sunrise, Sunset, Star,
  Sparkles, Zap, Flame, Droplet, Globe, Umbrella,
  // Travel
  Compass, Map, MapPin, Anchor, Ship, Sailboat,
  Rocket, Plane, Car, Bike, TrainFront, Tent,
  // Animals
  Cat, Dog, Bird, Fish, Rabbit, Turtle,
  Bug, PawPrint,
  // Food
  Coffee, Wine, Pizza, Cake, Apple, Cherry,
  Cookie, Utensils, IceCreamCone, Croissant,
  // Media
  Laptop, Monitor, Smartphone, Headphones, Camera, Film,
  Clapperboard, Music, Guitar, Mic, Radio, Tv,
  Gamepad2, Podcast,
  // Symbols
  Heart, Circle, Square, Triangle, Hexagon, Diamond,
  Crown, Award, Trophy, Medal, Gift, PartyPopper,
  Ghost, Skull, Swords, Shield, Key, Lock,
  Eye, Brain, Lightbulb, Puzzle,
  // Organisation
  Target, Flag, Tag, Folder, FolderOpen, Archive,
  Box, Package, Briefcase, Backpack, Luggage, Inbox,
  Layers, ListChecks, Clock, CalendarDays,
  // People and places
  User, Users, House, Building2, Store, Castle,
  Church, School, Landmark, Hourglass,
  // Craft and science
  Palette, Brush, Scissors, Wand, WandSparkles, Atom,
  Microscope, Telescope, FlaskConical, Dna, Coins, Wallet,
  Gem, Dice5,
}

export interface CollectionIconEntry {
  name: string
  Icon: LucideIcon
  // 'BookOpen' searched as 'book open', so typing what you see in the tooltip
  // finds the icon.
  search: string
}

export const collectionIcons: CollectionIconEntry[] = Object.entries(ICONS).map(([name, Icon]) => ({
  name,
  Icon,
  search: name.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase(),
}))

export function resolveCollectionIcon(name: string): LucideIcon | null {
  return (name && ICONS[name]) || null
}

export function collectionIconLabel(name: string): string {
  return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2')
}
