import { S } from '@/copy'

/** Интервалы автообновления. Крайние — те же, что принимает бэкенд: полчаса и трое суток.
 *
 *  Списком, а не полем для числа: человек выбирает «как часто», а не «сколько минут», и
 *  свободное число здесь означало бы ещё и разбор ошибок ввода ради значения, которых
 *  осмысленных десяток. */
export const AUTO_CHOICES: { min: number; label: string }[] = [
    { min: 0, label: S.vlessScreen.vruchnuyu },
    { min: 30, label: S.vlessScreen.kazhdye30Minut },
    { min: 60, label: S.vlessScreen.kazhdyyChas },
    { min: 120, label: S.vlessScreen.kazhdye2Chasa },
    { min: 180, label: S.vlessScreen.kazhdye3Chasa },
    { min: 360, label: S.vlessScreen.kazhdye6Chasov },
    { min: 720, label: S.vlessScreen.kazhdye12Chasov },
    { min: 1440, label: S.vlessScreen.razVSutki },
    { min: 2880, label: S.vlessScreen.razVDvoeSutok },
    { min: 4320, label: S.vlessScreen.razVTroeSutok },
]
