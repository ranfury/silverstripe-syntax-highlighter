<?php

namespace App\PageTypes;

use SilverStripe\Assets\Image;
use App\Models\Testimonial as Quote;
use Page;

class HomePage extends Page
{
    private static $db = [
        'Subtitle' => 'Varchar(255)',
        'Intro' => 'HTMLText',
    ];

    private static $has_one = [
        'HeroImage' => Image::class,
    ];

    private static $has_many = [
        'Testimonials' => Quote::class,
    ];

    private static array $many_many = [
        'RelatedPages' => \App\PageTypes\HomePage::class,
    ];

    private static $casting = [
        'ReadingTime' => 'Varchar',
    ];

    /**
     * @return string
     */
    public function getReadingTime()
    {
        return '5 min';
    }

    protected function hiddenHelper() {}
    private function alsoHidden() {}
}
