<?php

namespace Toast\Extensions;

use SilverStripe\Core\Extension;
use SilverStripe\Assets\Image;

class SiteConfigExtension extends Extension
{
    private static $db = [
        'CompanyEmail' => 'Varchar(255)',
    ];

    private static $has_one = [
        'TermsLink' => Image::class,
    ];
}
